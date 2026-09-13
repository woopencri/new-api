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
import { after, afterEach, test } from 'node:test'

import { Window } from 'happy-dom'

import type { ModelRatioData } from '../model-pricing-core'
import type { ModelPricingEditorPanelHandle } from '../model-pricing-sheet'

const dom = new Window()
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'localStorage',
  'ResizeObserver',
  'KeyboardEvent',
  'MouseEvent',
  'DocumentFragment',
  'IntersectionObserver',
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom[key],
  })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, StrictMode, createRef } = await import('react')
const { createRoot } = await import('react-dom/client')
const i18next = (await import('i18next')).default
const { initReactI18next } = await import('react-i18next')
await i18next.use(initReactI18next).init({ lng: 'en', resources: {} })
const { TieredPricingEditor } = await import('../tiered-pricing-editor')
const { ModelPricingEditorPanel } = await import('../model-pricing-sheet')
const { parseRequestPriceExpr } =
  await import('@/features/pricing/lib/request-price-expr')

const saved =
  'param("size") == "1024x1024" ? tier("1K", 0.015) : tier("default", 0.2)'
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
})
after(() => dom.close())

test('opening a saved request expression does not emit a default replacement', async () => {
  const changes: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <StrictMode>
        <TieredPricingEditor
          billingExpr={saved}
          requestRuleExpr=''
          onBillingExprChange={(value) => changes.push(value)}
          onRequestRuleExprChange={() => undefined}
        />
      </StrictMode>
    )
  })
  assert.deepEqual(changes, [], 'loading must not modify the billing draft')
  assert.equal(container.querySelector('textarea')?.value, saved)
})

test('loading a different saved expression on the same editor does not overwrite it', async () => {
  const changes: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  for (const expression of [
    'tier("base", p * 2 + c * 3)',
    saved,
    'tier("complex", max(0.1, p * 2))',
  ]) {
    await act(async () =>
      root?.render(
        <StrictMode>
          <TieredPricingEditor
            billingExpr={expression}
            requestRuleExpr=''
            onBillingExprChange={(value) => changes.push(value)}
            onRequestRuleExprChange={() => undefined}
          />
        </StrictMode>
      )
    )
    if (expression !== 'tier("base", p * 2 + c * 3)') {
      assert.equal(container.querySelector('textarea')?.value, expression)
    }
  }
  assert.deepEqual(changes, [])
})

// Exercise the actual panel's draft/save contract, including parent echoes.
async function renderPricingPanel(expression = saved, requestRuleExpr = '') {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const ref = createRef<ModelPricingEditorPanelHandle>()
  const editData = {
    name: 'image-model',
    billingMode: 'per_request_expr' as const,
    billingExpr: expression,
    requestRuleExpr,
  }
  await act(async () =>
    root?.render(
      <StrictMode>
        <ModelPricingEditorPanel ref={ref} editData={editData} />
      </StrictMode>
    )
  )
  return { container, ref, editData }
}

async function editPricingField(label: string, value: string, index = 0) {
  const labels = [...document.querySelectorAll('label')].filter(
    (element) => element.textContent === label
  )
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[id="${labels[index]?.htmlFor}"]`
  )
  assert.ok(field, `Missing pricing field: ${label}`)
  const prototype =
    field.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  assert.ok(setter)
  await act(async () => {
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return field
}

test('request tiers load visually, save unchanged, and round-trip edited prices and resolutions', async () => {
  const { container, ref, editData } = await renderPricingPanel()
  assert.equal(
    container.querySelector<HTMLInputElement>('input[value="0.015"]')?.value,
    '0.015'
  )
  assert.equal(container.querySelector('textarea')?.value, '1024x1024')
  const result: { data: ModelRatioData | null } = { data: null }
  await act(async () => {
    result.data = (await ref.current?.commitDraft()) ?? null
  })
  assert.equal(
    result.data?.billingExpr,
    saved,
    'opening and saving must preserve the exact expression'
  )
  await editPricingField('Price per request (USD)', '0.025')
  await editPricingField(
    'Matching values (one per line)',
    '1024x1024\n1536x1024'
  )
  await editPricingField('Fallback price (USD per request)', '0.3')
  await act(async () => {
    result.data = (await ref.current?.commitDraft()) ?? null
  })
  assert.equal(result.data?.billingMode, 'per_request_expr')
  const parsed = parseRequestPriceExpr(result.data?.billingExpr ?? '')
  assert.deepEqual(parsed?.tiers, [
    { label: '1K', values: '1024x1024\n1536x1024', price: '0.025' },
  ])
  assert.equal(parsed?.fallback.price, '0.3')
  await act(async () =>
    root?.render(
      <ModelPricingEditorPanel
        ref={ref}
        editData={{ ...editData, ...result.data }}
      />
    )
  )
  assert.equal(
    container.querySelector<HTMLInputElement>('input[value="0.025"]')?.value,
    '0.025'
  )
  assert.equal(
    container.querySelector('textarea')?.value,
    '1024x1024\n1536x1024'
  )
})

test('incomplete visual drafts block saving and mode changes until corrected', async () => {
  const { container, ref } = await renderPricingPanel()
  for (const invalidPrice of ['', '-0.1']) {
    const field = await editPricingField(
      'Price per request (USD)',
      invalidPrice
    )
    assert.equal(field.getAttribute('aria-invalid'), 'true')
    assert.ok(container.querySelector('[role="alert"]'))
    assert.equal(
      container.querySelector<HTMLButtonElement>('[aria-label="Editor mode"]')
        ?.disabled,
      true
    )
    let result: unknown
    await act(async () => {
      result = await ref.current?.commitDraft()
    })
    assert.equal(
      result,
      null,
      'save must not silently use the last valid price'
    )
  }
  await editPricingField('Price per request (USD)', '0')
  await act(async () => assert.ok(await ref.current?.commitDraft()))
  const add = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Add tier'
  )
  assert.ok(add)
  await act(async () => add.click())
  await act(async () => assert.equal(await ref.current?.commitDraft(), null))
  await editPricingField('Matching values (one per line)', '2048x2048', 1)
  await act(async () => assert.ok(await ref.current?.commitDraft()))
})

test('unsupported request formulas stay editable as text without being replaced', async () => {
  const expression =
    'param("size") == "1024x1024" ? tier("1K", 0.015 * 2) : tier("default", 0.2)'
  const { container, ref } = await renderPricingPanel(expression)
  assert.equal(container.querySelector('textarea')?.value, expression)
  await act(async () =>
    assert.equal((await ref.current?.commitDraft())?.billingExpr, expression)
  )
})

test('switching raw and visual modes preserves exact billing text and request multipliers', async () => {
  const rule = '(param("quality") == "high" ? 2 : 1)'
  const { container, ref } = await renderPricingPanel(saved, rule)
  for (const mode of ['Expression editor', 'Visual editor']) {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Editor mode"]'
    )
    assert.ok(trigger)
    await act(async () => trigger.click())
    const option = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((element) => element.textContent === mode)
    assert.ok(option, `Missing mode: ${mode}`)
    await act(async () => option.click())
    await act(async () => {
      const data = await ref.current?.commitDraft()
      assert.equal(data?.billingExpr, saved)
      assert.equal(data?.requestRuleExpr, rule)
    })
  }
  await editPricingField('Price per request (USD)', '0.03')
  await act(async () =>
    assert.equal((await ref.current?.commitDraft())?.requestRuleExpr, rule)
  )
})
