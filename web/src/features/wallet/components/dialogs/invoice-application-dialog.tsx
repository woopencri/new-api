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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatQuotaWithCurrency } from '@/lib/currency'

import { createInvoiceApplication } from '../../api'
import type { TopupRecord } from '../../types'

interface InvoiceApplicationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: TopupRecord | null
  defaultEmail: string
  feePercent: number
  onSuccess: () => Promise<void> | void
}

export function InvoiceApplicationDialog({
  open,
  onOpenChange,
  record,
  defaultEmail,
  feePercent,
  onSuccess,
}: InvoiceApplicationDialogProps) {
  const { t } = useTranslation()
  const [buyerName, setBuyerName] = useState('')
  const [taxpayerId, setTaxpayerId] = useState('')
  const [email, setEmail] = useState(defaultEmail)
  const [submitting, setSubmitting] = useState(false)
  const displayedFeePercent = Number.isFinite(feePercent)
    ? Number(feePercent.toFixed(2))
    : 0

  useEffect(() => {
    if (open) {
      setBuyerName('')
      setTaxpayerId('')
      setEmail(defaultEmail)
    }
  }, [open, defaultEmail])

  const submit = async () => {
    if (!record) return
    if (!buyerName.trim() || !taxpayerId.trim() || !email.trim()) {
      toast.error(t('Please complete the invoice information'))
      return
    }
    setSubmitting(true)
    try {
      const response = await createInvoiceApplication({
        topup_id: record.id,
        buyer_name: buyerName,
        taxpayer_id: taxpayerId,
        email,
      })
      if (response.success === true || response.message === 'success') {
        toast.success(t('Invoice application submitted'))
        onOpenChange(false)
        await onSuccess()
      } else {
        toast.error(
          response.message || t('Failed to submit invoice application')
        )
      }
    } catch {
      toast.error(t('Failed to submit invoice application'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Apply for invoice')}
      description={t('The invoice amount is fixed to this paid order.')}
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={submit} disabled={submitting || !record}>
            {submitting ? t('Submitting...') : t('Submit application')}
          </Button>
        </>
      }
    >
      {record ? (
        <div className='space-y-4'>
          <div className='grid grid-cols-2 gap-3 rounded-md border p-3 text-sm'>
            <div>
              <div className='text-muted-foreground'>{t('Order number')}</div>
              <div className='font-medium'>{record.trade_no}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>{t('Invoice amount')}</div>
              <div className='font-medium'>{record.money.toFixed(2)}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>
                {t('Handling fee percentage')}
              </div>
              <div className='font-medium'>{displayedFeePercent}%</div>
            </div>
            <div>
              <div className='text-muted-foreground'>
                {t('Balance deduction')}
              </div>
              <div className='font-medium'>
                {formatQuotaWithCurrency(record.invoice_fee_quota ?? 0, {
                  digitsLarge: 6,
                  digitsSmall: 6,
                  abbreviate: false,
                })}
              </div>
            </div>
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'The balance deduction is the balance credited by this order multiplied by the handling fee percentage.'
            )}
          </p>
          <div className='space-y-2'>
            <Label htmlFor='invoice-buyer-name'>{t('Buyer name')}</Label>
            <Input
              id='invoice-buyer-name'
              value={buyerName}
              onChange={(event) => setBuyerName(event.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='invoice-taxpayer-id'>
              {t('Taxpayer identification number')}
            </Label>
            <Input
              id='invoice-taxpayer-id'
              value={taxpayerId}
              onChange={(event) => setTaxpayerId(event.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='invoice-email'>
              {t('Invoice receiving email')}
            </Label>
            <Input
              id='invoice-email'
              type='email'
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <p className='text-muted-foreground text-xs leading-relaxed'>
            {t(
              'Invoices are usually issued within 1–3 business days. The handling fee is deducted directly from your account balance. Invoice type: ordinary invoice.'
            )}
          </p>
        </div>
      ) : null}
    </Dialog>
  )
}
