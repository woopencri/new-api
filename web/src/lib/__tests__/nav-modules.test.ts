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
import { describe, test } from 'node:test'

import {
  BUILTIN_NAV_KEYS,
  parseCustomNavLinks,
  parseHeaderNavModules,
  serializeHeaderNavModules,
} from '../nav-modules'

describe('parseCustomNavLinks', () => {
  test('parses a valid serialized array', () => {
    const raw = JSON.stringify([
      {
        name: 'GitHub',
        url: 'https://github.com',
        newWindow: true,
        enabled: true,
        requireAuth: false,
      },
      {
        name: 'Docs',
        url: '/docs',
        newWindow: false,
        enabled: false,
        requireAuth: true,
      },
    ])
    assert.deepEqual(parseCustomNavLinks(raw), [
      {
        name: 'GitHub',
        url: 'https://github.com',
        newWindow: true,
        enabled: true,
        requireAuth: false,
      },
      {
        name: 'Docs',
        url: '/docs',
        newWindow: false,
        enabled: false,
        requireAuth: true,
      },
    ])
  })

  test('returns empty array for invalid JSON, empty string, and non-array input', () => {
    assert.deepEqual(parseCustomNavLinks('not json'), [])
    assert.deepEqual(parseCustomNavLinks(''), [])
    assert.deepEqual(parseCustomNavLinks('  '), [])
    assert.deepEqual(parseCustomNavLinks(undefined), [])
    assert.deepEqual(parseCustomNavLinks(null), [])
    assert.deepEqual(parseCustomNavLinks('{"name":"x"}'), [])
    assert.deepEqual(parseCustomNavLinks(42), [])
  })

  test('applies defaults for missing boolean fields', () => {
    assert.deepEqual(
      parseCustomNavLinks('[{"name":"Blog","url":"https://example.com"}]'),
      [
        {
          name: 'Blog',
          url: 'https://example.com',
          newWindow: true,
          enabled: true,
          requireAuth: false,
        },
      ]
    )
  })

  test('drops items with missing names or unsafe urls', () => {
    const raw = JSON.stringify([
      { name: '', url: 'https://example.com' },
      { name: 'NoUrl' },
      { name: 'Evil', url: 'javascript:alert(1)' },
      { name: 'Relative', url: 'docs/page' },
      { name: 'Ok', url: '/pricing' },
      'not-an-object',
      null,
    ])
    assert.deepEqual(parseCustomNavLinks(raw), [
      {
        name: 'Ok',
        url: '/pricing',
        newWindow: true,
        enabled: true,
        requireAuth: false,
      },
    ])
  })
})

describe('parseHeaderNavModules', () => {
  test('legacy JSON without order/labels falls back to defaults', () => {
    const modules = parseHeaderNavModules(
      JSON.stringify({
        home: false,
        console: true,
        pricing: { enabled: false, requireAuth: true },
        rankings: true,
        docs: true,
        about: true,
      })
    )
    assert.deepEqual(modules.order, [...BUILTIN_NAV_KEYS])
    assert.deepEqual(modules.labels, {})
    assert.equal(modules.home, false)
    assert.deepEqual(modules.pricing, { enabled: false, requireAuth: true })
  })

  test('normalizes order: drops unknown keys, dedupes, appends missing', () => {
    const modules = parseHeaderNavModules(
      JSON.stringify({
        order: ['console', 'bogus', 'console', 'about', 42],
      })
    )
    assert.deepEqual(modules.order, [
      'console',
      'about',
      'home',
      'pricing',
      'rankings',
      'docs',
    ])
  })

  test('filters labels: unknown keys, empty strings, non-strings dropped', () => {
    const modules = parseHeaderNavModules(
      JSON.stringify({
        labels: {
          home: '首页站',
          bogus: 'x',
          console: '   ',
          docs: 123,
          about: '',
        },
      })
    )
    assert.deepEqual(modules.labels, { home: '首页站' })
  })

  test('serialize then parse round-trips', () => {
    const modules = parseHeaderNavModules(
      JSON.stringify({
        home: false,
        pricing: { enabled: true, requireAuth: true },
        order: ['docs', 'home'],
        labels: { docs: 'Wiki' },
      })
    )
    const roundTripped = parseHeaderNavModules(
      serializeHeaderNavModules(modules)
    )
    assert.deepEqual(roundTripped, modules)
  })

  test('simple modules keep defaults when given object values', () => {
    const modules = parseHeaderNavModules(
      JSON.stringify({
        home: { enabled: false },
        docs: { enabled: false },
      })
    )
    assert.equal(modules.home, true)
    assert.equal(modules.docs, true)
  })
})
