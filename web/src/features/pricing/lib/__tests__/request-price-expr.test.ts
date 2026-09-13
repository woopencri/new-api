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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  generateRequestPriceExpr,
  parseRequestPriceExpr,
  validateRequestPriceConfig,
  type RequestPriceConfig,
} from '../request-price-expr'

const resolutionExpression = `(
  param("size") == "1024x1024" || param("size") == "1536x1024" || param("size") == "1024x1536"
) ? tier("1K", 0.015) : (
  (param("size") == "2048x2048" || param("size") == "2048x1152" || param("size") == "2048x1536" || param("size") == "1152x2048" || param("size") == "1536x2048")
  ? tier("2K", 0.2) : (
    (param("size") == "3840x2160" || param("size") == "2160x3840")
    ? tier("4K", 0.2) : tier("default", 0.2)
  )
)`

describe('request-price expressions', () => {
  test('round-trips all ten resolution choices and the fallback without losing prices or order', () => {
    const config = parseRequestPriceExpr(resolutionExpression)
    assert.ok(config)
    assert.equal(config.paramPath, 'size')
    assert.deepEqual(
      config.tiers.map((tier) => [tier.label, tier.price]),
      [
        ['1K', '0.015'],
        ['2K', '0.2'],
        ['4K', '0.2'],
      ]
    )
    assert.deepEqual(
      config.tiers.map((tier) => tier.values.split('\n')),
      [
        ['1024x1024', '1536x1024', '1024x1536'],
        ['2048x2048', '2048x1152', '2048x1536', '1152x2048', '1536x2048'],
        ['3840x2160', '2160x3840'],
      ]
    )
    assert.deepEqual(config.fallback, { label: 'default', price: '0.2' })
    assert.deepEqual(
      parseRequestPriceExpr(generateRequestPriceExpr(config)),
      config
    )
  })

  test('supports a fixed request price including zero and preserves v1', () => {
    for (const expression of ['tier("base", 0.15)', 'v1:tier("free", 0)']) {
      const config = parseRequestPriceExpr(expression)
      assert.ok(config)
      assert.equal(config.tiers.length, 0)
      assert.equal(generateRequestPriceExpr(config), expression)
    }
  })

  test('preserves nested grouping, escaped labels and string comparisons', () => {
    const expression = `v1:((param("image.size") == "a\\"b") || (param("image.size") == "c")) ? (tier("a\\"b", 1e-3)) : tier("other", 2)`
    const config = parseRequestPriceExpr(expression)
    assert.ok(config)
    assert.equal(config.paramPath, 'image.size')
    assert.deepEqual(
      parseRequestPriceExpr(generateRequestPriceExpr(config)),
      config
    )
  })

  test('does not partially convert unsupported expressions or unsafe prices', () => {
    const unsupported = [
      'p * 1 + c * 2',
      'v2:tier("base", 1)',
      'tier("base", -1)',
      'tier("base", 1e999)',
      'tier("base", 0.1 * 2)',
      'param("n") == 2 ? tier("two", 1) : tier("other", 2)',
      'param("size") == "a" && param("quality") == "b" ? tier("a", 1) : tier("b", 2)',
      'param("size") == "a" || param("quality") == "b" ? tier("a", 1) : tier("b", 2)',
      'param("size") == "a" ? tier("a", 1) : (param("quality") == "b" ? tier("b", 2) : tier("c", 3))',
      'tier("base", 1) + 2',
      'tier("base", 1))',
    ]
    for (const expression of unsupported) {
      assert.equal(parseRequestPriceExpr(expression), null, expression)
    }
  })

  test('rejects incomplete drafts and invalid prices instead of silently changing the charge', () => {
    const original = parseRequestPriceExpr(resolutionExpression)
    assert.ok(original)
    for (const price of ['', '-1', 'NaN', 'Infinity', '1e999']) {
      const config: RequestPriceConfig = {
        ...original,
        fallback: { ...original.fallback, price },
      }
      assert.ok(validateRequestPriceConfig(config))
      assert.throws(() => generateRequestPriceExpr(config))
    }
    assert.ok(validateRequestPriceConfig({ ...original, paramPath: '' }))
    assert.ok(
      validateRequestPriceConfig({
        ...original,
        tiers: [{ label: '1K', values: '', price: '0.015' }],
      })
    )
  })
})
