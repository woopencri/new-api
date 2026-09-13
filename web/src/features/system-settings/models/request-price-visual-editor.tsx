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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  generateRequestPriceExpr,
  validateRequestPriceConfig,
  type RequestPriceConfig,
} from '@/features/pricing/lib/request-price-expr'

type RequestPriceVisualEditorProps = {
  expression: string
  config: RequestPriceConfig
  onChange: (expression: string) => void
  onValidityChange: (valid: boolean) => void
}

export function RequestPriceVisualEditor(props: RequestPriceVisualEditorProps) {
  const { t } = useTranslation()
  const id = useId()
  const [draft, setDraft] = useState(() => ({
    expression: props.expression,
    config: props.config,
    tierIds: props.config.tiers.map((_, index) => index),
  }))
  // Keep incomplete input local, but replace it when a different saved expression
  // is loaded. Only explicit edits emit changes, never initialization.
  if (draft.expression !== props.expression) {
    setDraft({
      expression: props.expression,
      config: props.config,
      tierIds: props.config.tiers.map((_, index) => index),
    })
  }
  const config = draft.config
  const error = validateRequestPriceConfig(config)

  const updateConfig = (next: RequestPriceConfig, tierIds = draft.tierIds) => {
    const valid = validateRequestPriceConfig(next) === null
    const expression = valid ? generateRequestPriceExpr(next) : draft.expression
    setDraft({ expression, config: next, tierIds })
    props.onValidityChange(valid)
    if (valid) props.onChange(expression)
  }

  return (
    <FieldGroup>
      <FieldDescription>
        {t(
          'Match request parameter values in order. Prices are USD per request; unmatched or missing values use the fallback price.'
        )}
      </FieldDescription>
      <Field data-invalid={error === 'parameter'}>
        <FieldLabel htmlFor={`${id}-path`}>
          {t('Request parameter path')}
        </FieldLabel>
        <Input
          id={`${id}-path`}
          value={config.paramPath}
          placeholder='size'
          aria-invalid={error === 'parameter'}
          onChange={(event) =>
            updateConfig({ ...config, paramPath: event.target.value })
          }
        />
      </Field>
      {config.tiers.map((tier, index) => (
        <FieldSet key={draft.tierIds[index]} className='rounded-md border p-3'>
          <FieldLegend variant='label'>
            {t('Tier')} {index + 1}
          </FieldLegend>
          <FieldGroup>
            <Field data-invalid={!tier.label.trim()}>
              <FieldLabel htmlFor={`${id}-label-${index}`}>
                {t('Tier name')}
              </FieldLabel>
              <Input
                id={`${id}-label-${index}`}
                value={tier.label}
                aria-invalid={!tier.label.trim()}
                onChange={(event) =>
                  updateConfig({
                    ...config,
                    tiers: config.tiers.map((item, i) =>
                      i === index
                        ? { ...item, label: event.target.value }
                        : item
                    ),
                  })
                }
              />
            </Field>
            <Field
              data-invalid={
                !tier.values.split('\n').some((value) => value !== '')
              }
            >
              <FieldLabel htmlFor={`${id}-values-${index}`}>
                {t('Matching values (one per line)')}
              </FieldLabel>
              <Textarea
                id={`${id}-values-${index}`}
                value={tier.values}
                rows={3}
                placeholder={'1024x1024\n1536x1024\n1024x1536'}
                aria-invalid={
                  !tier.values.split('\n').some((value) => value !== '')
                }
                onChange={(event) =>
                  updateConfig({
                    ...config,
                    tiers: config.tiers.map((item, i) =>
                      i === index
                        ? { ...item, values: event.target.value }
                        : item
                    ),
                  })
                }
              />
            </Field>
            <Field
              data-invalid={
                !tier.price ||
                !Number.isFinite(Number(tier.price)) ||
                Number(tier.price) < 0
              }
            >
              <FieldLabel htmlFor={`${id}-price-${index}`}>
                {t('Price per request (USD)')}
              </FieldLabel>
              <Input
                id={`${id}-price-${index}`}
                type='number'
                min={0}
                step='any'
                value={tier.price}
                aria-invalid={
                  !tier.price ||
                  !Number.isFinite(Number(tier.price)) ||
                  Number(tier.price) < 0
                }
                onChange={(event) =>
                  updateConfig({
                    ...config,
                    tiers: config.tiers.map((item, i) =>
                      i === index
                        ? { ...item, price: event.target.value }
                        : item
                    ),
                  })
                }
              />
            </Field>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() =>
                updateConfig(
                  {
                    ...config,
                    tiers: config.tiers.filter((_, i) => i !== index),
                  },
                  draft.tierIds.filter((_, i) => i !== index)
                )
              }
            >
              {t('Remove tier')}
            </Button>
          </FieldGroup>
        </FieldSet>
      ))}
      <Button
        type='button'
        variant='outline'
        onClick={() =>
          updateConfig(
            {
              ...config,
              tiers: [
                ...config.tiers,
                {
                  label: `tier_${config.tiers.length + 1}`,
                  values: '',
                  price: config.fallback.price,
                },
              ],
            },
            [...draft.tierIds, Math.max(-1, ...draft.tierIds) + 1]
          )
        }
      >
        {t('Add tier')}
      </Button>
      <FieldSet className='rounded-md border p-3'>
        <FieldLegend variant='label'>{t('Fallback tier')}</FieldLegend>
        <FieldGroup>
          <Field data-invalid={!config.fallback.label.trim()}>
            <FieldLabel htmlFor={`${id}-fallback-label`}>
              {t('Tier name')}
            </FieldLabel>
            <Input
              id={`${id}-fallback-label`}
              value={config.fallback.label}
              aria-invalid={!config.fallback.label.trim()}
              onChange={(event) =>
                updateConfig({
                  ...config,
                  fallback: { ...config.fallback, label: event.target.value },
                })
              }
            />
          </Field>
          <Field
            data-invalid={
              !config.fallback.price ||
              !Number.isFinite(Number(config.fallback.price)) ||
              Number(config.fallback.price) < 0
            }
          >
            <FieldLabel htmlFor={`${id}-fallback-price`}>
              {t('Fallback price (USD per request)')}
            </FieldLabel>
            <Input
              id={`${id}-fallback-price`}
              type='number'
              min={0}
              step='any'
              value={config.fallback.price}
              aria-invalid={
                !config.fallback.price ||
                !Number.isFinite(Number(config.fallback.price)) ||
                Number(config.fallback.price) < 0
              }
              onChange={(event) =>
                updateConfig({
                  ...config,
                  fallback: { ...config.fallback, price: event.target.value },
                })
              }
            />
          </Field>
        </FieldGroup>
      </FieldSet>
      {error && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'Complete all tier names, matching values and non-negative prices before saving or switching editors.'
            )}
          </AlertDescription>
        </Alert>
      )}
    </FieldGroup>
  )
}
