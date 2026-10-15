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

import type { AxiosAdapter } from 'axios'
import { Window } from 'happy-dom'

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
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom[key],
  })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const i18next = (await import('i18next')).default
const { initReactI18next } = await import('react-i18next')
await i18next.use(initReactI18next).init({ lng: 'en', resources: {} })
const { api } = await import('@/lib/api')
const { RequestRoutingSection } = await import('../request-routing-section')
const { SettingsPageProvider } =
  await import('../../components/settings-page-context')

const saved = JSON.stringify({
  enabled: true,
  unmatched_action: 'reject',
  rules: [
    {
      name: '1K',
      model: 'image',
      param_path: 'size',
      values: ['1024x1024', '1920x1080'],
      channel_ids: [11, 12],
      match_all: false,
    },
    {
      name: '2K',
      model: 'image',
      param_path: 'size',
      values: ['2560x1440'],
      channel_ids: [21],
      match_all: false,
    },
  ],
})
let root: ReturnType<typeof createRoot> | undefined
let queryClient: InstanceType<typeof QueryClient> | undefined
const originalAdapter = api.defaults.adapter
afterEach(async () => {
  await act(async () => root?.unmount())
  queryClient?.clear()
  api.defaults.adapter = originalAdapter
  document.body.innerHTML = ''
})
after(() => dom.close())

async function renderRoutingSection(
  value = saved,
  responseSuccess: boolean | 'network-error' = true
) {
  const requests: { key: string; value: string }[] = []
  const adapter: AxiosAdapter = async (config) => {
    requests.push(JSON.parse(config.data))
    if (responseSuccess === 'network-error') {
      throw new Error('Network request failed')
    }
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        success: responseSuccess,
        message: responseSuccess ? '' : 'Rejected policy',
      },
    }
  }
  api.defaults.adapter = adapter
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  const container = document.createElement('div')
  const actions = document.createElement('div')
  document.body.append(container, actions)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <QueryClientProvider
        client={queryClient as InstanceType<typeof QueryClient>}
      >
        <SettingsPageProvider actionsContainer={actions}>
          <RequestRoutingSection value={value} />
        </SettingsPageProvider>
      </QueryClientProvider>
    )
  )
  return { container, requests }
}

async function editRoutingInput(label: string, value: string, index = 0) {
  const labels = [...document.querySelectorAll('label')].filter(
    (element) => element.textContent === label
  )
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[id="${labels[index]?.htmlFor}"]`
  )
  assert.ok(input, `Missing field: ${label}`)
  const prototype =
    input.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  assert.ok(setter)
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return input
}

async function clickRoutingButton(name: string) {
  const button = [...document.querySelectorAll('button')].find(
    (element) =>
      element.textContent === name ||
      element.getAttribute('aria-label') === name
  )
  assert.ok(button, `Missing button: ${name}`)
  await act(async () => button.click())
}

test('editing a saved routing rule submits the complete policy without changing other pools', async () => {
  const { container, requests } = await renderRoutingSection()
  assert.equal(
    container.querySelector('textarea')?.value,
    '1024x1024\n1920x1080'
  )
  assert.equal(
    container.querySelector<HTMLButtonElement>('[aria-label="Move up"]')
      ?.disabled,
    true
  )
  await editRoutingInput('Allowed channel IDs', '31, 32')
  await clickRoutingButton('Save Changes')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].key, 'RequestRoutingSetting')
  const policy = JSON.parse(requests[0].value)
  assert.deepEqual(policy.rules[0].channel_ids, [31, 32])
  assert.deepEqual(policy.rules[1].channel_ids, [21])
  assert.equal(policy.enabled, true)
})

test('adding an incomplete rule prevents saving until corrected or removed', async () => {
  const { requests } = await renderRoutingSection()
  await clickRoutingButton('Add routing rule')
  await clickRoutingButton('Save Changes')
  assert.equal(requests.length, 0)
  assert.ok(document.querySelector('[aria-invalid="true"]'))
  await editRoutingInput('Rule name', '4K', 2)
  await editRoutingInput('Request Model', 'image', 2)
  await editRoutingInput(
    'Matching values (one per line)',
    '3840x2160\n2160x3840',
    2
  )
  await editRoutingInput('Allowed channel IDs', '41', 2)
  await clickRoutingButton('Save Changes')
  assert.equal(requests.length, 1)
  assert.equal(JSON.parse(requests[0].value).rules.length, 3)
})

test('moving and deleting rules preserves rule values and submission order', async () => {
  const { requests } = await renderRoutingSection()
  await clickRoutingButton('Move down')
  await clickRoutingButton('Save Changes')
  assert.deepEqual(
    JSON.parse(requests[0].value).rules.map(
      (rule: { name: string }) => rule.name
    ),
    ['2K', '1K']
  )
  await clickRoutingButton('Delete')
  await clickRoutingButton('Save Changes')
  assert.deepEqual(
    JSON.parse(requests[1].value).rules.map(
      (rule: { name: string }) => rule.name
    ),
    ['1K']
  )
})

test('a rejected update keeps the edited values available for correction', async () => {
  const { requests } = await renderRoutingSection(saved, false)
  const input = await editRoutingInput('Allowed channel IDs', '77')
  await clickRoutingButton('Save Changes')
  assert.equal(requests.length, 1)
  assert.equal(input.value, '77')
  assert.equal(document.querySelector('fieldset')?.disabled, false)
})

test('an invalid saved policy shows an error instead of silently loading an empty replacement', async () => {
  const { container, requests } = await renderRoutingSection('{broken')
  assert.ok(container.querySelector('[role="alert"]'))
  assert.equal(container.querySelector('input'), null)
  assert.equal(requests.length, 0)
})

test('a network failure retains the draft and re-enables editing', async () => {
  const { requests } = await renderRoutingSection(saved, 'network-error')
  const input = await editRoutingInput('Allowed channel IDs', '88')
  await clickRoutingButton('Save Changes')
  assert.equal(requests.length, 1)
  assert.equal(input.value, '88')
  assert.equal(document.querySelector('fieldset')?.disabled, false)
})
