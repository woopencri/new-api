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
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  BUILTIN_NAV_KEYS,
  type BuiltinNavKey,
  type CustomNavLink,
  type HeaderNavModules,
  parseHeaderNavModules,
  serializeCustomNavLinks,
  serializeHeaderNavModules,
} from '@/lib/nav-modules'

import {
  SettingsControlChildren,
  SettingsForm,
  SettingsSwitchContent,
  SettingsControlGroup,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const headerNavSchema = z.object({
  builtins: z.array(
    z.object({
      key: z.enum(BUILTIN_NAV_KEYS),
      label: z.string(),
      enabled: z.boolean(),
      requireAuth: z.boolean(),
    })
  ),
  customLinks: z.array(
    z.object({
      name: z.string().trim().min(1, 'Link name is required'),
      url: z
        .string()
        .trim()
        .regex(/^(https?:\/\/|\/)\S*$/, 'URL must start with http(s):// or /'),
      newWindow: z.boolean(),
      enabled: z.boolean(),
      requireAuth: z.boolean(),
    })
  ),
})

type HeaderNavFormValues = z.infer<typeof headerNavSchema>

type HeaderNavigationSectionProps = {
  config: HeaderNavModules
  initialSerialized: string
  customLinks: CustomNavLink[]
  initialCustomLinksSerialized: string
}

const isBuiltinEnabled = (
  config: HeaderNavModules,
  key: BuiltinNavKey
): boolean => {
  if (key === 'pricing' || key === 'rankings') return config[key].enabled
  return config[key]
}

const builtinRequireAuth = (
  config: HeaderNavModules,
  key: BuiltinNavKey
): boolean => {
  if (key === 'pricing' || key === 'rankings') return config[key].requireAuth
  return false
}

const toFormValues = (
  config: HeaderNavModules,
  customLinks: CustomNavLink[]
): HeaderNavFormValues => ({
  builtins: config.order.map((key) => ({
    key,
    label: config.labels[key] ?? '',
    enabled: isBuiltinEnabled(config, key),
    requireAuth: builtinRequireAuth(config, key),
  })),
  customLinks: customLinks.map((link) => ({ ...link })),
})

export function HeaderNavigationSection({
  config,
  initialSerialized,
  customLinks,
  initialCustomLinksSerialized,
}: HeaderNavigationSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const formDefaults = useMemo(
    () => toFormValues(config, customLinks),
    [config, customLinks]
  )

  const form = useForm<HeaderNavFormValues>({
    resolver: zodResolver(headerNavSchema),
    defaultValues: formDefaults,
  })

  const builtinArray = useFieldArray({
    control: form.control,
    name: 'builtins',
  })

  const customLinkArray = useFieldArray({
    control: form.control,
    name: 'customLinks',
  })

  useEffect(() => {
    form.reset(formDefaults)
  }, [formDefaults, form])

  const onSubmit = async (values: HeaderNavFormValues) => {
    const payload: HeaderNavModules = {
      ...config,
      order: values.builtins.map((item) => item.key),
      labels: {},
    }
    for (const item of values.builtins) {
      if (item.key === 'pricing' || item.key === 'rankings') {
        payload[item.key] = {
          enabled: item.enabled,
          requireAuth: item.requireAuth,
        }
      } else {
        payload[item.key] = item.enabled
      }
      const label = item.label.trim()
      if (label !== '') {
        payload.labels[item.key] = label
      }
    }

    const serialized = serializeHeaderNavModules(payload)
    if (serialized !== initialSerialized) {
      await updateOption.mutateAsync({
        key: 'HeaderNavModules',
        value: serialized,
      })
    }

    const customLinksSerialized = serializeCustomNavLinks(
      values.customLinks.map((link) => ({
        name: link.name.trim(),
        url: link.url.trim(),
        newWindow: link.newWindow,
        enabled: link.enabled,
        requireAuth: link.requireAuth,
      }))
    )
    if (customLinksSerialized !== initialCustomLinksSerialized) {
      await updateOption.mutateAsync({
        key: 'HeaderNavCustomLinks',
        value: customLinksSerialized,
      })
    }
  }

  const resetToDefault = () => {
    form.reset(toFormValues(parseHeaderNavModules(undefined), []))
  }

  const builtinMeta: Record<
    BuiltinNavKey,
    {
      title: string
      description: string
      requireAuthTitle?: string
      requireAuthDescription?: string
    }
  > = {
    home: {
      title: t('Home'),
      description: t('Landing page with system overview.'),
    },
    console: {
      title: t('Console'),
      description: t('User dashboard and quota controls.'),
    },
    pricing: {
      title: t('Model Square'),
      description: t('Public model catalog and pricing page.'),
      requireAuthTitle: t('Require login to view models'),
      requireAuthDescription: t(
        'Visitors must authenticate before accessing the pricing directory.'
      ),
    },
    rankings: {
      title: t('Rankings'),
      description: t('Public rankings page based on live usage data.'),
      requireAuthTitle: t('Require login to view rankings'),
      requireAuthDescription: t(
        'Visitors must authenticate before accessing the rankings page.'
      ),
    },
    docs: {
      title: t('Docs'),
      description: t('Documentation or external knowledge base.'),
    },
    about: {
      title: t('About'),
      description: t('Static page describing the platform.'),
    },
  }

  return (
    <SettingsSection title={t('Header navigation')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            onReset={resetToDefault}
            isSaving={updateOption.isPending}
            resetLabel='Reset to default'
            saveLabel='Save navigation'
          />
          <div data-settings-form-span='full' className='min-w-0 space-y-3'>
            <div className='space-y-0.5'>
              <p className='text-sm font-medium'>{t('Built-in links')}</p>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Rename, reorder, and toggle the built-in navigation items. Leave the name empty to use the default.'
                )}
              </p>
            </div>

            {builtinArray.fields.map((fieldItem, index) => {
              const meta = builtinMeta[fieldItem.key]
              return (
                <SettingsControlGroup key={fieldItem.id}>
                  <SettingsSwitchItem>
                    <div className='flex flex-col gap-1'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('Move up')}
                        disabled={index === 0}
                        onClick={() => builtinArray.swap(index, index - 1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('Move down')}
                        disabled={index === builtinArray.fields.length - 1}
                        onClick={() => builtinArray.swap(index, index + 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                    <SettingsSwitchContent>
                      <FormLabel>{meta.title}</FormLabel>
                      <FormDescription>{meta.description}</FormDescription>
                      <FormField
                        control={form.control}
                        name={`builtins.${index}.label`}
                        render={({ field }) => (
                          <FormItem className='mt-2'>
                            <FormControl>
                              <Input
                                placeholder={meta.title}
                                aria-label={t('Display name')}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </SettingsSwitchContent>
                    <FormField
                      control={form.control}
                      name={`builtins.${index}.enabled`}
                      render={({ field }) => (
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      )}
                    />
                  </SettingsSwitchItem>

                  {meta.requireAuthTitle ? (
                    <FormField
                      control={form.control}
                      name={`builtins.${index}.requireAuth`}
                      render={({ field }) => (
                        <SettingsControlChildren>
                          <SettingsSwitchItem className='py-2'>
                            <SettingsSwitchContent>
                              <FormLabel>{meta.requireAuthTitle}</FormLabel>
                              <FormDescription>
                                {meta.requireAuthDescription}
                              </FormDescription>
                            </SettingsSwitchContent>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={
                                  !form.watch(`builtins.${index}.enabled`)
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </SettingsSwitchItem>
                        </SettingsControlChildren>
                      )}
                    />
                  ) : null}
                </SettingsControlGroup>
              )
            })}
          </div>

          <div data-settings-form-span='full' className='min-w-0 space-y-3'>
            <div className='space-y-0.5'>
              <p className='text-sm font-medium'>{t('Custom links')}</p>
              <p className='text-muted-foreground text-xs'>
                {t('Extra navigation items appended after the built-in links.')}
              </p>
            </div>

            {customLinkArray.fields.map((fieldItem, index) => (
              <SettingsControlGroup key={fieldItem.id}>
                <div className='grid gap-3 py-1 md:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name={`customLinks.${index}.name`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Link name')}</FormLabel>
                        <FormControl>
                          <Input placeholder='GitHub' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`customLinks.${index}.url`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Link URL')}</FormLabel>
                        <FormControl>
                          <Input placeholder='https://example.com' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className='flex flex-wrap items-center gap-x-6 gap-y-2 pb-1'>
                  <FormField
                    control={form.control}
                    name={`customLinks.${index}.newWindow`}
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center gap-2'>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className='text-sm font-normal'>
                          {t('Open in new window')}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`customLinks.${index}.enabled`}
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center gap-2'>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className='text-sm font-normal'>
                          {t('Enabled')}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`customLinks.${index}.requireAuth`}
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center gap-2'>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className='text-sm font-normal'>
                          {t('Require login to show')}
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <div className='ml-auto flex items-center gap-1'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('Move up')}
                      disabled={index === 0}
                      onClick={() => customLinkArray.swap(index, index - 1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('Move down')}
                      disabled={index === customLinkArray.fields.length - 1}
                      onClick={() => customLinkArray.swap(index, index + 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:text-destructive'
                      onClick={() => customLinkArray.remove(index)}
                    >
                      <Trash2 />
                      {t('Remove link')}
                    </Button>
                  </div>
                </div>
              </SettingsControlGroup>
            ))}

            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() =>
                customLinkArray.append({
                  name: '',
                  url: '',
                  newWindow: true,
                  enabled: true,
                  requireAuth: false,
                })
              }
            >
              <Plus />
              {t('Add link')}
            </Button>
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
