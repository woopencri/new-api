/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export type RequestPriceTier = {
  label: string
  price: string
  values: string
}

export type RequestPriceConfig = {
  version: '' | 'v1:'
  paramPath: string
  tiers: RequestPriceTier[]
  fallback: Pick<RequestPriceTier, 'label' | 'price'>
}

const pricePattern = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

export function validateRequestPriceConfig(
  config: RequestPriceConfig
): string | null {
  if (config.tiers.length && !config.paramPath.trim()) return 'parameter'
  for (const tier of [...config.tiers, config.fallback]) {
    if (!tier.label.trim()) return 'label'
    if (
      !pricePattern.test(tier.price) ||
      !Number.isFinite(Number(tier.price))
    ) {
      return 'price'
    }
  }
  if (
    config.tiers.some(
      (tier) => !tier.values.split('\n').some((value) => value !== '')
    )
  ) {
    return 'values'
  }
  return null
}

export function generateRequestPriceExpr(config: RequestPriceConfig): string {
  if (validateRequestPriceConfig(config)) {
    throw new Error('Invalid request-price configuration')
  }
  let expression = `tier(${JSON.stringify(config.fallback.label)}, ${config.fallback.price})`
  for (let index = config.tiers.length - 1; index >= 0; index--) {
    const tier = config.tiers[index]
    const condition = tier.values
      .split('\n')
      .filter((value) => value !== '')
      .map(
        (value) =>
          `param(${JSON.stringify(config.paramPath)}) == ${JSON.stringify(value)}`
      )
      .join(' || ')
    expression = `(${condition}) ? tier(${JSON.stringify(tier.label)}, ${tier.price}) : (${expression})`
  }
  return config.version + expression
}

// A deliberately restricted, full-consumption parser. Unsupported expressions
// must stay in the raw editor; a partial conversion could change the bill.
function unwrapGroup(tokens: string[]): string[] {
  while (tokens[0] === '(') {
    let depth = 0
    const closing = tokens.findIndex((token) => {
      if (token === '(') depth++
      if (token === ')') depth--
      return depth === 0
    })
    if (closing !== tokens.length - 1) break
    tokens = tokens.slice(1, -1)
  }
  return tokens
}

function findTopLevelToken(tokens: string[], target: string): number {
  let depth = 0
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === '(') depth++
    if (tokens[index] === ')') depth--
    if (depth === 0 && tokens[index] === target) return index
  }
  return -1
}

function parseFixedPrice(
  tokens: string[]
): RequestPriceConfig['fallback'] | null {
  const parts = unwrapGroup(tokens)
  if (
    parts.length !== 6 ||
    parts[0] !== 'tier' ||
    parts[1] !== '(' ||
    parts[3] !== ',' ||
    parts[5] !== ')'
  ) {
    return null
  }
  if (!parts[2].startsWith('"') || !pricePattern.test(parts[4])) return null
  return { label: JSON.parse(parts[2]) as string, price: parts[4] }
}

function parseParameterChoices(
  tokens: string[]
): { path: string; values: string[] } | null {
  const parts = unwrapGroup(tokens)
  const split = findTopLevelToken(parts, '||')
  if (split >= 0) {
    const left = parseParameterChoices(parts.slice(0, split))
    const right = parseParameterChoices(parts.slice(split + 1))
    if (!left || !right || left.path !== right.path) return null
    return { path: left.path, values: [...left.values, ...right.values] }
  }
  if (
    parts.length !== 6 ||
    parts[0] !== 'param' ||
    parts[1] !== '(' ||
    parts[3] !== ')' ||
    parts[4] !== '=='
  ) {
    return null
  }
  if (!parts[2].startsWith('"') || !parts[5].startsWith('"')) return null
  const path = JSON.parse(parts[2]) as string
  const value = JSON.parse(parts[5]) as string
  // The visual control stores one value per line, so these stay in raw mode.
  if (!value || /[\r\n]/.test(value)) return null
  return { path, values: [value] }
}

export function parseRequestPriceExpr(
  expression: string
): RequestPriceConfig | null {
  try {
    let source = expression.trim()
    const version = source.startsWith('v1:') ? 'v1:' : ''
    if (version) source = source.slice(3)
    const tokenPattern =
      /\s*("(?:\\.|[^"\\])*"|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|param\b|tier\b|\|\||==|[(),?:])/y
    let position = 0
    const tokens: string[] = []
    while (position < source.length) {
      if (!source.slice(position).trim()) break
      tokenPattern.lastIndex = position
      const match = tokenPattern.exec(source)
      if (!match) return null
      tokens.push(match[1])
      position = tokenPattern.lastIndex
    }
    let depth = 0
    for (const token of tokens) {
      if (token === '(') depth++
      if (token === ')') depth--
      if (depth < 0) return null
    }
    if (depth !== 0) return null

    const config: RequestPriceConfig = {
      version,
      paramPath: 'size',
      tiers: [],
      fallback: { label: 'default', price: '0' },
    }
    let remaining = unwrapGroup(tokens)
    while (remaining.length) {
      const question = findTopLevelToken(remaining, '?')
      if (question < 0) {
        const fallback = parseFixedPrice(remaining)
        if (!fallback) return null
        config.fallback = fallback
        return validateRequestPriceConfig(config) ? null : config
      }
      const colon = findTopLevelToken(remaining, ':')
      if (colon <= question) return null
      const choices = parseParameterChoices(remaining.slice(0, question))
      const price = parseFixedPrice(remaining.slice(question + 1, colon))
      if (!choices || !price) return null
      if (config.tiers.length && choices.path !== config.paramPath) return null
      config.paramPath = choices.path
      config.tiers.push({ ...price, values: choices.values.join('\n') })
      remaining = unwrapGroup(remaining.slice(colon + 1))
    }
    return null
  } catch {
    return null
  }
}
