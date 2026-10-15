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
import { test } from 'node:test'

import {
  parseRequestRoutingDraft,
  requestRoutingFormSchema,
  routingDraftToConfig,
  type RequestRoutingDraft,
} from '../lib/request-routing'

const savedPolicy = {
  enabled: true,
  unmatched_action: 'reject',
  rules: [
    {
      name: '1K',
      model: 'image',
      param_path: 'size',
      values: ['1024x1024', '1920x1080'],
      channel_ids: [11, 12],
      match_all: false,
    },
    { name: 'fallback', model: 'image', channel_ids: [21], match_all: true },
  ],
}

test('saved routing rules retain exact model, dimensions, channel pool and fallback order', () => {
  const draft = parseRequestRoutingDraft(JSON.stringify(savedPolicy))
  assert.ok(draft)
  assert.equal(draft.rules[0].values, '1024x1024\n1920x1080')
  assert.equal(draft.rules[0].channel_ids, '11, 12')
  assert.equal(draft.rules[1].match_all, true)
  assert.ok(requestRoutingFormSchema.safeParse(draft).success)
  assert.deepEqual(routingDraftToConfig(draft).rules[0], savedPolicy.rules[0])
})

test('invalid channel IDs and empty match values cannot be saved as an unrestricted pool', () => {
  const draft = parseRequestRoutingDraft(JSON.stringify(savedPolicy))
  assert.ok(draft)
  for (const channelIds of [
    '',
    '0',
    '-1',
    '11,11',
    '1.2',
    '1e3',
    '2147483648',
    'one',
  ]) {
    const changed: RequestRoutingDraft = {
      ...draft,
      rules: [{ ...draft.rules[0], channel_ids: channelIds }],
    }
    assert.equal(
      requestRoutingFormSchema.safeParse(changed).success,
      false,
      channelIds
    )
  }
  for (const change of [
    { name: '' },
    { model: '' },
    { param_path: '' },
    { values: '' },
  ]) {
    assert.equal(
      requestRoutingFormSchema.safeParse({
        ...draft,
        rules: [{ ...draft.rules[0], ...change }],
      }).success,
      false
    )
  }
  assert.equal(parseRequestRoutingDraft('invalid'), null)
  assert.equal(parseRequestRoutingDraft('{}'), null)
})

test('duplicate rule names and specific rules after a same-model fallback are rejected', () => {
  const draft = parseRequestRoutingDraft(JSON.stringify(savedPolicy))
  assert.ok(draft)
  assert.equal(
    requestRoutingFormSchema.safeParse({
      ...draft,
      rules: [draft.rules[1], draft.rules[0]],
    }).success,
    false
  )
  assert.equal(
    requestRoutingFormSchema.safeParse({
      ...draft,
      rules: [draft.rules[0], { ...draft.rules[0] }],
    }).success,
    false
  )
  assert.equal(
    requestRoutingFormSchema.safeParse({
      ...draft,
      rules: [draft.rules[1], { ...draft.rules[0], model: 'other' }],
    }).success,
    true
  )
})
