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
import { z } from 'zod'

export const routingValidationMessage =
  'Complete routing rule names, models, matching values and valid channel IDs.'
const bytes = (value: string, limit: number) =>
  new TextEncoder().encode(value).length <= limit
const text = z.string().trim().min(1, routingValidationMessage)
const channelIds = z
  .array(z.number().int().positive().max(2147483647))
  .min(1)
  .max(256)
  .refine((ids) => new Set(ids).size === ids.length)

export const requestRoutingConfigSchema = z
  .object({
    enabled: z.boolean(),
    unmatched_action: z.enum(['reject', 'normal']),
    rules: z
      .array(
        z.object({
          name: text.refine((value) => bytes(value, 128)),
          model: text.refine((value) => bytes(value, 255)),
          param_path: z.string().default(''),
          values: z
            .array(
              z
                .string()
                .min(1)
                .refine((value) => bytes(value, 1024))
            )
            .default([]),
          channel_ids: channelIds,
          match_all: z.boolean().default(false),
        })
      )
      .max(128),
  })
  .superRefine((config, context) => {
    const names = new Set<string>()
    const fallbacks = new Set<string>()
    config.rules.forEach((rule, index) => {
      if (names.has(rule.name)) {
        context.addIssue({
          code: 'custom',
          path: ['rules', index, 'name'],
          message: routingValidationMessage,
        })
      }
      names.add(rule.name)
      if (fallbacks.has(rule.model)) {
        context.addIssue({
          code: 'custom',
          path: ['rules', index, 'model'],
          message: routingValidationMessage,
        })
      }
      if (rule.match_all) fallbacks.add(rule.model)
      if (
        !rule.match_all &&
        (!rule.param_path.trim() ||
          !bytes(rule.param_path, 256) ||
          rule.values.length === 0 ||
          rule.values.length > 512)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rules', index, 'values'],
          message: routingValidationMessage,
        })
      }
    })
  })

export type RequestRoutingConfig = z.infer<typeof requestRoutingConfigSchema>
export const emptyRequestRouting: RequestRoutingConfig = {
  enabled: false,
  unmatched_action: 'reject',
  rules: [],
}

export function routingConfigToDraft(config: RequestRoutingConfig) {
  return {
    ...config,
    rules: config.rules.map((rule) => ({
      ...rule,
      values: rule.values.join('\n'),
      channel_ids: rule.channel_ids.join(', '),
    })),
  }
}

const ruleDraftSchema = z.object({
  name: z.string(),
  model: z.string(),
  param_path: z.string(),
  values: z.string(),
  channel_ids: z.string(),
  match_all: z.boolean(),
})
export type RequestRoutingRuleDraft = z.infer<typeof ruleDraftSchema>

export function routingDraftToConfig(draft: {
  enabled: boolean
  unmatched_action: 'reject' | 'normal'
  rules: RequestRoutingRuleDraft[]
}): RequestRoutingConfig {
  return {
    ...draft,
    rules: draft.rules.map((rule) => ({
      ...rule,
      name: rule.name.trim(),
      model: rule.model.trim(),
      values: rule.values.split(/\r?\n/).filter((value) => value !== ''),
      channel_ids: rule.channel_ids
        .trim()
        .split(/[\s,，]+/)
        .filter(Boolean)
        .map((value) => (/^\d+$/.test(value) ? Number(value) : Number.NaN)),
    })),
  }
}

export const requestRoutingFormSchema = z
  .object({
    enabled: z.boolean(),
    unmatched_action: z.enum(['reject', 'normal']),
    rules: z.array(ruleDraftSchema),
  })
  .superRefine((draft, context) => {
    const result = requestRoutingConfigSchema.safeParse(
      routingDraftToConfig(draft)
    )
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          code: 'custom',
          path: issue.path.slice(0, 3),
          message: routingValidationMessage,
        })
      }
    }
  })
export type RequestRoutingDraft = z.infer<typeof requestRoutingFormSchema>

export function parseRequestRoutingDraft(
  raw: string
): RequestRoutingDraft | null {
  try {
    const config = requestRoutingConfigSchema.parse(JSON.parse(raw))
    return routingConfigToDraft(config)
  } catch {
    return null
  }
}
