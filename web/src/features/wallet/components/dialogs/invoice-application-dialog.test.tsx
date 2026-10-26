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
const { api } = await import('@/lib/api')
const { DEFAULT_CURRENCY_CONFIG, useSystemConfigStore } =
  await import('@/stores/system-config-store')
const { InvoiceApplicationDialog } =
  await import('./invoice-application-dialog')

let root: ReturnType<typeof createRoot> | undefined
const originalAdapter = api.defaults.adapter
const originalConfig = useSystemConfigStore.getState().config

afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ''
  api.defaults.adapter = originalAdapter
  useSystemConfigStore.setState({ config: originalConfig })
  localStorage.clear()
})
after(() => dom.close())

test('invoice quote displays the monetary balance deduction and submits editable recipient details', async () => {
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  let submitted: unknown
  api.defaults.adapter = async (config) => {
    assert.equal(config.url, '/api/user/invoice/applications')
    submitted = JSON.parse(config.data as string)
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true },
    }
  }
  let finish: () => void = () => undefined
  const completed = new Promise<void>((resolve) => {
    finish = resolve
  })
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <InvoiceApplicationDialog
        open
        onOpenChange={() => undefined}
        record={{
          id: 8,
          user_id: 1,
          amount: 8,
          money: 8,
          trade_no: 'paid-order',
          payment_method: 'alipay',
          create_time: 1,
          status: 'success',
          invoice_fee_amount: 0.48,
          invoice_fee_quota: 240000,
        }}
        defaultEmail='account@example.com'
        feePercent={6}
        onSuccess={finish}
      />
    )
  })
  assert.match(document.body.textContent ?? '', /Handling fee percentage6%/)
  assert.match(document.body.textContent ?? '', /Balance deduction\$0\.48/)
  assert.match(document.body.textContent ?? '', /1–3 business days/)
  assert.match(
    document.body.textContent ?? '',
    /deducted directly from your account balance/
  )
  assert.match(document.body.textContent ?? '', /ordinary invoice/)
  assert.doesNotMatch(document.body.textContent ?? '', /240000/)
  const email = document.querySelector('#invoice-email') as HTMLInputElement
  assert.equal(email.value, 'account@example.com')
  await act(async () => {
    for (const [id, value] of [
      ['invoice-buyer-name', 'Buyer Ltd'],
      ['invoice-taxpayer-id', 'TAX-123'],
      ['invoice-email', 'billing@example.com'],
    ]) {
      const input = document.querySelector(`#${id}`) as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      assert.ok(setter)
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  const submit = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === 'Submit application'
  )
  assert.ok(submit)
  await act(async () => {
    submit.click()
    await completed
  })
  assert.deepEqual(submitted, {
    topup_id: 8,
    buyer_name: 'Buyer Ltd',
    taxpayer_id: 'TAX-123',
    email: 'billing@example.com',
  })
})

test('closed invoice orders show the closed message and a fresh application button', async () => {
  const { QueryClient, QueryClientProvider, notifyManager } =
    await import('@tanstack/react-query')
  const { BillingHistoryDialog } = await import('./billing-history-dialog')
  const { useAuthStore } = await import('@/stores/auth-store')
  const originalAuth = useAuthStore.getState().auth
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'invoice-user',
    role: 1,
    email: 'account@example.com',
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  notifyManager.setScheduler(queueMicrotask)
  let refreshedBalance = false
  api.defaults.adapter = async (config) => {
    let data: unknown
    if (config.url === '/api/user/invoice/config') {
      data = {
        enabled: true,
        can_apply: true,
        email: 'account@example.com',
        fee_percent: 6,
        min_amount: 0,
        permission_mode: 'all',
      }
    } else {
      assert.ok(config.url?.startsWith('/api/user/topup/self'))
      data = {
        total: 1,
        items: [
          {
            id: 8,
            user_id: 1,
            amount: 8,
            money: 8,
            trade_no: 'closed-paid-order',
            payment_method: 'alipay',
            create_time: 1,
            status: 'success',
            invoice_status: 'closed',
            invoice_available: true,
            invoice_fee_amount: 0.48,
            invoice_fee_quota: 240000,
          },
        ],
      }
    }
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data },
    }
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  try {
    await act(async () =>
      root?.render(
        <QueryClientProvider client={queryClient}>
          <BillingHistoryDialog
            open
            onOpenChange={() => undefined}
            onBalanceChange={async () => {
              refreshedBalance = true
            }}
          />
        </QueryClientProvider>
      )
    )
    assert.match(document.body.textContent ?? '', /Invoice application closed/)
    const apply = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Apply for invoice'
    )
    assert.ok(apply)
    assert.equal(apply.disabled, false)
    assert.equal(refreshedBalance, true)
    await act(async () => apply.click())
    const buyer = document.querySelector<HTMLInputElement>(
      '#invoice-buyer-name'
    )
    assert.ok(buyer)
    assert.equal(buyer.value, '')
    assert.equal(
      document.querySelector<HTMLInputElement>('#invoice-email')?.value,
      'account@example.com'
    )
  } finally {
    await act(async () => root?.unmount())
    root = undefined
    queryClient.clear()
    useAuthStore.setState({ auth: originalAuth })
    notifyManager.setScheduler((callback) => setTimeout(callback, 0))
  }
})
