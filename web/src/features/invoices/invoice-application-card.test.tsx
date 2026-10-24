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

const dom = new Window({ url: 'http://localhost/' })
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
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
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const i18next = (await import('i18next')).default
const { initReactI18next } = await import('react-i18next')
await i18next.use(initReactI18next).init({ lng: 'en', resources: {} })
const { InvoiceApplicationCard } = await import('./invoice-application-card')
const zh = (await import('@/i18n/locales/zh.json')).default
const en = (await import('@/i18n/locales/en.json')).default
i18next.addResourceBundle('zh', 'translation', zh.translation)
i18next.addResourceBundle('en', 'translation', en.translation)

let root: ReturnType<typeof createRoot> | undefined
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard'
)
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  if (clipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})
after(() => dom.close())

const application = {
  id: 1,
  user_id: 8,
  topup_id: 10,
  trade_no: 'paid-order',
  buyer_name: '星河信息科技有限公司',
  taxpayer_id: '91310115MA2K8X7P6Q',
  email: 'invoice@example.com',
  amount: 1288.5,
  fee_percent: 6,
  fee_amount: 77.31,
  fee_quota: 38655000,
  fee_refunded: false,
  version: 1,
  status: 'pending' as const,
  create_time: 1,
}

async function renderCard(
  onSave: (
    application: import('../wallet/types').InvoiceApplication,
    status: string
  ) => Promise<void>
) {
  await i18next.changeLanguage('zh')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <InvoiceApplicationCard application={application} onSave={onSave} />
    )
  )
}

test('Chinese status selection stays local until its save button is clicked', async () => {
  const saved: string[] = []
  await renderCard(async (_application, status) => {
    saved.push(status)
  })
  const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')
  assert.ok(trigger)
  assert.equal(trigger.textContent, '待确认')
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === i18next.t('Save changes')
  )
  assert.ok(save)
  assert.ok(save.disabled)
  await act(async () => trigger.click())
  const options = [...document.querySelectorAll('[role="option"]')]
  assert.deepEqual(
    options.map((option) => option.textContent),
    ['待确认', '已完成', '关闭申请']
  )
  const close = options.find((option) => option.textContent === '关闭申请') as
    | HTMLElement
    | undefined
  assert.ok(close)
  await act(async () => close.click())
  assert.deepEqual(saved, [])
  assert.equal(trigger.textContent, '关闭申请')
  assert.equal(save.disabled, false)
  await act(async () => save.click())
  assert.deepEqual(saved, ['closed'])
  await act(async () => {
    await i18next.changeLanguage('en')
  })
  assert.equal(trigger.textContent, 'Close application')
})

test('copy button writes only company, tax ID, and fixed two-decimal amount on separate lines', async () => {
  let copied = ''
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copied = value
      },
    },
  })
  await renderCard(async () => undefined)
  const copy = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === '复制开票信息'
  )
  assert.ok(copy)
  await act(async () => copy.click())
  assert.equal(
    copied,
    '公司：星河信息科技有限公司\n税号：91310115MA2K8X7P6Q\n金额：1288.50'
  )
})

test('legacy rejected applications display closed and allow saving their missing refund', async () => {
  await i18next.changeLanguage('zh')
  const saved: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <InvoiceApplicationCard
        application={{ ...application, status: 'rejected', version: 0 }}
        onSave={async (_application, status) => {
          saved.push(status)
        }}
      />
    )
  )
  const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]')
  assert.ok(trigger)
  assert.equal(trigger.textContent, '关闭申请')
  assert.ok(trigger.disabled)
  assert.match(document.body.textContent ?? '', /开票申请已关闭/)
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === i18next.t('Save changes')
  )
  assert.ok(save)
  assert.equal(save.disabled, false)
  await act(async () => save.click())
  assert.deepEqual(saved, ['closed'])
})

test('invoice page uses Chinese labels for permission, status filter, and saved status values', async () => {
  const { QueryClient, QueryClientProvider, notifyManager } =
    await import('@tanstack/react-query')
  const { api } = await import('@/lib/api')
  const { Invoices } = await import('./index')
  const originalAdapter = api.defaults.adapter
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  notifyManager.setScheduler(queueMicrotask)
  api.defaults.adapter = async (config) => {
    let data: unknown
    if (config.url === '/api/invoice/admin/config') {
      data = {
        enabled: true,
        fee_percent: 6,
        min_amount: 0,
        max_age_days: 7,
        permission_mode: 'specified',
      }
    } else {
      assert.equal(config.url, '/api/invoice/admin/applications')
      data = { items: [application], total: 1 }
    }
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data },
    }
  }
  try {
    await i18next.changeLanguage('zh')
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Invoices />
        </QueryClientProvider>
      )
    )
    const triggers = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="combobox"]'),
    ]
    assert.deepEqual(
      triggers.map((trigger) => trigger.textContent),
      ['指定用户', '全部状态', '待确认']
    )
  } finally {
    await act(async () => root?.unmount())
    root = undefined
    api.defaults.adapter = originalAdapter
    queryClient.clear()
    notifyManager.setScheduler((callback) => setTimeout(callback, 0))
  }
})
