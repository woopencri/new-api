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
import { InvoiceApplicationCard } from './invoice-application-card'

const defaultConfig: InvoiceConfig = {
  enabled: false,
  fee_percent: 0,
  min_amount: 0,
  max_age_days: 0,
  permission_mode: 'specified',
  can_apply: false,
  email: '',
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
    if (
      !Number.isInteger(config.max_age_days) ||
      config.max_age_days < 0 ||
      config.max_age_days > 36500
    ) {
      toast.error(t('Enter a whole number of days between 0 and 36500.'))
      return
    }
    setSaving(true)
    try {
      const response = await updateAdminInvoiceConfig({
        enabled: config.enabled,
        fee_percent: Number(config.fee_percent),
        min_amount: Number(config.min_amount),
        max_age_days: config.max_age_days,
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
    try {
      const response = await updateAdminInvoiceApplication(application.id, {
        status: nextStatus,
        remark: application.remark,
        version: application.version,
      })
      if (response.success && response.data) {
        const updated = response.data
        toast.success(t('Invoice status updated'))
        setApplications((current) =>
          current.map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item
          )
        )
      } else {
        toast.error(response.message || t('Failed to update invoice status'))
      }
    } catch {
      toast.error(t('Failed to update invoice status'))
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
          <InvoiceApplicationCard
            key={`${application.id}:${application.version}`}
            application={application}
            onSave={updateStatus}
          />
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
                <Label htmlFor='invoice-max-age-days'>
                  {t('Invoice application window (days)')}
                </Label>
                <Input
                  id='invoice-max-age-days'
                  type='number'
                  min='0'
                  max='36500'
                  step='1'
                  value={config.max_age_days}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      max_age_days: Number(event.target.value),
                    })
                  }
                />
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Counted from payment completion. Set to 0 for no time limit. Expired orders cannot be invoiced.'
                  )}
                </p>
              </div>
              <div className='space-y-2'>
                <Label>{t('Invoice permission')}</Label>
                <Select
                  items={[
                    { value: 'specified', label: t('Specified users') },
                    { value: 'all', label: t('All users') },
                  ]}
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
                  items={[
                    { value: '', label: t('All statuses') },
                    { value: 'pending', label: t('Pending') },
                    { value: 'completed', label: t('Completed') },
                    { value: 'closed', label: t('Close application') },
                  ]}
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
                    <SelectItem value='closed'>
                      {t('Close application')}
                    </SelectItem>
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
