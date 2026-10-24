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
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import {
  getAdminInvoiceApplications,
  getAdminInvoiceConfig,
  updateAdminInvoiceApplication,
  updateAdminInvoiceConfig,
} from '../wallet/api'
import type { InvoiceApplication, InvoiceConfig } from '../wallet/types'

const defaultConfig: InvoiceConfig = {
  enabled: false,
  fee_percent: 0,
  min_amount: 0,
  permission_mode: 'specified',
  can_apply: false,
  email: '',
}

function statusLabel(status: string, t: (key: string) => string) {
  if (status === 'completed') return t('Completed')
  if (status === 'rejected') return t('Rejected')
  return t('Pending')
}

export function Invoices() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<InvoiceConfig>(defaultConfig)
  const [applications, setApplications] = useState<InvoiceApplication[]>([])
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const configQuery = useQuery({
    queryKey: ['admin-invoice-config'],
    queryFn: getAdminInvoiceConfig,
  })

  useEffect(() => {
    if (configQuery.data?.data) {
      setConfig((current) => ({ ...current, ...configQuery.data.data }))
    }
  }, [configQuery.data])

  const loadApplications = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getAdminInvoiceApplications({
        keyword,
        status,
        page_size: 100,
      })
      if (response.success && response.data) {
        setApplications(response.data.items || [])
      } else {
        toast.error(
          response.message || t('Failed to load invoice applications')
        )
      }
    } catch {
      toast.error(t('Failed to load invoice applications'))
    } finally {
      setLoading(false)
    }
  }, [keyword, status, t])

  useEffect(() => {
    void loadApplications()
  }, [loadApplications])

  const saveConfig = async () => {
    setSaving(true)
    try {
      const response = await updateAdminInvoiceConfig({
        enabled: config.enabled,
        fee_percent: Number(config.fee_percent),
        min_amount: Number(config.min_amount),
        permission_mode: config.permission_mode,
      })
      if (response.success) {
        toast.success(t('Invoice settings saved'))
        if (response.data) {
          setConfig((current) => ({ ...current, ...response.data }))
        }
      } else {
        toast.error(response.message || t('Failed to save invoice settings'))
      }
    } catch {
      toast.error(t('Failed to save invoice settings'))
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (
    application: InvoiceApplication,
    nextStatus: string
  ) => {
    const response = await updateAdminInvoiceApplication(application.id, {
      status: nextStatus,
    })
    if (response.success) {
      toast.success(t('Invoice status updated'))
      setApplications((current) =>
        current.map((item) => {
          if (item.id !== application.id) return item
          return {
            ...item,
            status: nextStatus as InvoiceApplication['status'],
          }
        })
      )
    } else {
      toast.error(response.message || t('Failed to update invoice status'))
    }
  }

  let applicationsContent
  if (loading) {
    applicationsContent = (
      <p className='text-muted-foreground'>{t('Loading...')}</p>
    )
  } else if (applications.length === 0) {
    applicationsContent = (
      <p className='text-muted-foreground'>
        {t('No invoice applications found')}
      </p>
    )
  } else {
    applicationsContent = (
      <div className='space-y-3'>
        {applications.map((application) => (
          <div
            key={application.id}
            className='grid gap-3 rounded-md border p-3 lg:grid-cols-[1fr_1fr_auto]'
          >
            <div className='space-y-1 text-sm'>
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
                {t('Balance deduction')}: {application.fee_quota}
              </div>
              <Badge
                variant={
                  application.status === 'completed' ? 'default' : 'secondary'
                }
              >
                {statusLabel(application.status, t)}
              </Badge>
            </div>
            <div className='flex items-start justify-end'>
              <Select
                value={application.status}
                onValueChange={(value) => {
                  if (value) void updateStatus(application, value)
                }}
              >
                <SelectTrigger className='w-32'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='pending'>{t('Pending')}</SelectItem>
                  <SelectItem value='completed'>{t('Completed')}</SelectItem>
                  <SelectItem value='rejected'>{t('Rejected')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Invoices')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>{t('Invoice settings')}</CardTitle>
            </CardHeader>
            <CardContent className='grid gap-4 md:grid-cols-2'>
              <div className='flex items-center justify-between rounded-md border p-3'>
                <div>
                  <Label>{t('Enable invoice feature')}</Label>
                  <p className='text-muted-foreground text-xs'>
                    {t('Turn off to hide invoice access for all users.')}
                  </p>
                </div>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(checked) =>
                    setConfig({ ...config, enabled: checked })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label>{t('Handling fee percentage')}</Label>
                <Input
                  type='number'
                  min='0'
                  max='100'
                  step='0.01'
                  value={config.fee_percent}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      fee_percent: Number(event.target.value),
                    })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label>{t('Minimum order amount')}</Label>
                <Input
                  type='number'
                  min='0'
                  step='0.01'
                  value={config.min_amount}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      min_amount: Number(event.target.value),
                    })
                  }
                />
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'The invoice button appears only when the paid order amount is higher than this value.'
                  )}
                </p>
              </div>
              <div className='space-y-2'>
                <Label>{t('Invoice permission')}</Label>
                <Select
                  value={config.permission_mode}
                  onValueChange={(value) => {
                    if (value) {
                      setConfig({
                        ...config,
                        permission_mode:
                          value as InvoiceConfig['permission_mode'],
                      })
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='specified'>
                      {t('Specified users')}
                    </SelectItem>
                    <SelectItem value='all'>{t('All users')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='flex justify-end md:col-span-2'>
                <Button onClick={saveConfig} disabled={saving}>
                  {saving ? t('Saving...') : t('Save settings')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('Invoice applications')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex flex-col gap-2 sm:flex-row'>
                <Input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder={t('Search invoice applications')}
                />
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value ?? '')}
                >
                  <SelectTrigger className='sm:w-44'>
                    <SelectValue placeholder={t('All statuses')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value=''>{t('All statuses')}</SelectItem>
                    <SelectItem value='pending'>{t('Pending')}</SelectItem>
                    <SelectItem value='completed'>{t('Completed')}</SelectItem>
                    <SelectItem value='rejected'>{t('Rejected')}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant='outline'
                  onClick={() => void loadApplications()}
                >
                  {t('Search')}
                </Button>
              </div>
              {applicationsContent}
            </CardContent>
          </Card>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
