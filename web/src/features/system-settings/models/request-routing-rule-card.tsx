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
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useWatch, type Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import type { RequestRoutingDraft } from './lib/request-routing'

type RuleCardProps = {
  control: Control<RequestRoutingDraft>
  index: number
  count: number
  remove: () => void
  move: (direction: -1 | 1) => void
}

export function RequestRoutingRuleCard(props: RuleCardProps) {
  const { t } = useTranslation()
  const matchAll = useWatch({
    control: props.control,
    name: `rules.${props.index}.match_all`,
  })
  return (
    <FieldSet className='min-w-0 rounded-lg border p-4'>
      <FieldLegend variant='label'>
        {t('Routing rule')} {props.index + 1}
      </FieldLegend>
      <FieldGroup className='gap-4'>
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            size='icon'
            aria-label={t('Move up')}
            disabled={props.index === 0}
            onClick={() => props.move(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type='button'
            variant='outline'
            size='icon'
            aria-label={t('Move down')}
            disabled={props.index === props.count - 1}
            onClick={() => props.move(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            type='button'
            variant='outline'
            size='icon'
            aria-label={t('Delete')}
            onClick={props.remove}
          >
            <Trash2 />
          </Button>
        </div>
        <div className='grid gap-4 md:grid-cols-2'>
          <FormField
            control={props.control}
            name={`rules.${props.index}.name`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Rule name')}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder='1K' />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={props.control}
            name={`rules.${props.index}.model`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Request Model')}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder='image-model' />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={props.control}
          name={`rules.${props.index}.match_all`}
          render={({ field }) => (
            <FormItem className='flex items-center justify-between gap-3'>
              <FormLabel>
                {t('Match all parameter values (fallback)')}
              </FormLabel>
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
        {!matchAll && (
          <>
            <FormField
              control={props.control}
              name={`rules.${props.index}.param_path`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Request parameter path')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='size' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={props.control}
              name={`rules.${props.index}.values`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Matching values (one per line)')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      placeholder={'1024x1024\n1280x720\n1920x1080'}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
        <FormField
          control={props.control}
          name={`rules.${props.index}.channel_ids`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Allowed channel IDs')}</FormLabel>
              <FormControl>
                <Input {...field} placeholder='1, 2' />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </FieldGroup>
    </FieldSet>
  )
}
