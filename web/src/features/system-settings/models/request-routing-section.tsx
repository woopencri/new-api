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
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FieldSet } from '@/components/ui/field'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  emptyRequestRouting,
  parseRequestRoutingDraft,
  requestRoutingFormSchema,
  routingConfigToDraft,
  routingDraftToConfig,
  type RequestRoutingDraft,
} from './lib/request-routing'
import { RequestRoutingRuleCard } from './request-routing-rule-card'

export function RequestRoutingSection(props: { value: string }) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const parsed = useMemo(
    () => parseRequestRoutingDraft(props.value),
    [props.value]
  )
  const form = useForm<RequestRoutingDraft>({
    resolver: zodResolver(requestRoutingFormSchema),
    defaultValues: parsed ?? routingConfigToDraft(emptyRequestRouting),
  })
  const rules = useFieldArray({ control: form.control, name: 'rules' })
  const onSubmit = async (draft: RequestRoutingDraft) => {
    if (!parsed) return
    try {
      const result = await updateOption.mutateAsync({
        key: 'RequestRoutingSetting',
        value: JSON.stringify(routingDraftToConfig(draft)),
      })
      if (result.success) form.reset(draft)
    } catch {
      // The shared mutation reports the error. Keep the draft for correction.
    }
  }
  if (!parsed) {
    return (
      <Alert variant='destructive'>
        <AlertDescription>
          {t(
            'Cannot load request routing settings. Fix the stored configuration before editing.'
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <SettingsSection title={t('Request parameter routing')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            onReset={() => form.reset(parsed)}
          />
          <FieldSet disabled={updateOption.isPending} className='gap-5'>
            <Alert>
              <AlertDescription>
                {t(
                  'Rules match in order for the exact request model. Only permitted, enabled channels in the matched pool can be used, including retries. Billing and upstream model mapping are unchanged.'
                )}
              </AlertDescription>
            </Alert>
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-3'>
                  <FormLabel>{t('Enable request parameter routing')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='unmatched_action'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('When no routing rule matches')}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    items={[
                      { value: 'reject', label: t('Reject the request') },
                      {
                        value: 'normal',
                        label: t('Use normal channel selection'),
                      },
                    ]}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value='reject'>
                          {t('Reject the request')}
                        </SelectItem>
                        <SelectItem value='normal'>
                          {t('Use normal channel selection')}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {t(
                      'Applies only to models with routing rules. A matched pool with no available channels always fails without leaving the pool.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Enter channel IDs from the Channels page, separated by commas. Put fallback rules after specific rules for the same model.'
              )}
            </p>
            {rules.fields.map((rule, index) => (
              <RequestRoutingRuleCard
                key={rule.id}
                control={form.control}
                index={index}
                count={rules.fields.length}
                remove={() => rules.remove(index)}
                move={(direction) => rules.move(index, index + direction)}
              />
            ))}
            {form.formState.errors.rules?.root?.message && (
              <Alert variant='destructive'>
                <AlertDescription>
                  {t(form.formState.errors.rules.root.message)}
                </AlertDescription>
              </Alert>
            )}
            <Button
              type='button'
              variant='outline'
              disabled={rules.fields.length >= 128}
              onClick={() =>
                rules.append({
                  name: '',
                  model: '',
                  param_path: 'size',
                  values: '',
                  channel_ids: '',
                  match_all: false,
                })
              }
            >
              <Plus data-icon='inline-start' />
              {t('Add routing rule')}
            </Button>
          </FieldSet>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
