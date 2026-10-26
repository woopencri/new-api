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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatQuotaWithCurrency } from '@/lib/currency'

import type { InvoiceApplication } from '../wallet/types'

interface InvoiceApplicationCardProps {
  application: InvoiceApplication
  onSave: (application: InvoiceApplication, status: string) => Promise<void>
  onDelete: (application: InvoiceApplication) => Promise<void>
}

export function InvoiceApplicationCard({
  application,
  onSave,
  onDelete,
}: InvoiceApplicationCardProps) {
  const { t } = useTranslation()
  const closed =
    application.status === 'closed' || application.status === 'rejected'
  const savedStatus = closed ? 'closed' : application.status
  const [draftStatus, setDraftStatus] = useState(savedStatus)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { copyToClipboard } = useCopyToClipboard()
  const statusOptions = [
    { value: 'pending', label: t('Pending') },
    { value: 'completed', label: t('Completed') },
    { value: 'closed', label: t('Close application') },
  ]
  let statusLabel = t('Pending')
  if (savedStatus === 'completed') statusLabel = t('Completed')
  if (closed) statusLabel = t('Invoice application closed')

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(application, draftStatus)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await onDelete(application)
      setDeleteDialogOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <article
      aria-label={t('Invoice for {{name}}', { name: application.buyer_name })}
      className='grid gap-3 rounded-md border p-3 lg:grid-cols-[1fr_1fr_auto]'
    >
      <div className='min-w-0 space-y-1 text-sm break-words'>
        <div className='font-medium'>{application.buyer_name}</div>
        <div>
          {t('User')}: {application.user?.username || application.user_id}
        </div>
        <div>
          {t('Order number')}: {application.trade_no}
        </div>
        <div>
          {t('Taxpayer identification number')}: {application.taxpayer_id}
        </div>
        <div>
          {t('Invoice receiving email')}: {application.email}
        </div>
      </div>
      <div className='space-y-1 text-sm'>
        <div>
          {t('Invoice amount')}: {application.amount.toFixed(2)}
        </div>
        <div>
          {t('Handling fee')}: {application.fee_amount.toFixed(2)}
        </div>
        <div>
          {t('Balance deduction')}:{' '}
          {formatQuotaWithCurrency(application.fee_quota, {
            digitsLarge: 6,
            digitsSmall: 6,
            abbreviate: false,
          })}
        </div>
        <div className='flex flex-wrap gap-2'>
          <Badge
            variant={savedStatus === 'completed' ? 'default' : 'secondary'}
          >
            {statusLabel}
          </Badge>
          {application.fee_refunded && (
            <Badge variant='secondary'>{t('Handling fee refunded')}</Badge>
          )}
        </div>
      </div>
      <div className='flex flex-wrap items-start justify-end gap-2 lg:max-w-64'>
        <Select
          items={statusOptions}
          value={draftStatus}
          disabled={saving || closed}
          onValueChange={(value) => {
            if (value) setDraftStatus(value as typeof draftStatus)
          }}
        >
          <SelectTrigger className='w-36' aria-label={t('Invoice status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={() => void save()}
          disabled={
            saving ||
            (draftStatus === savedStatus &&
              !(closed && !application.fee_refunded))
          }
        >
          {saving ? t('Saving...') : t('Save changes')}
        </Button>
        <Button
          variant='outline'
          onClick={() =>
            void copyToClipboard(
              [
                t('Company: {{name}}', { name: application.buyer_name }),
                t('Tax ID: {{id}}', { id: application.taxpayer_id }),
                t('Amount: {{amount}}', {
                  amount: application.amount.toFixed(2),
                }),
              ].join('\n')
            )
          }
        >
          {t('Copy invoice information')}
        </Button>
        {(savedStatus === 'completed' || closed) && (
          <Button
            variant='destructive'
            onClick={() => setDeleteDialogOpen(true)}
            disabled={saving || deleting}
          >
            {t('Delete application')}
          </Button>
        )}
      </div>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('Delete invoice application?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This only hides the completed or closed invoice application from the admin list. The user order record stays unchanged.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void remove()}
              disabled={deleting}
            >
              {deleting ? t('Deleting...') : t('Confirm delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
