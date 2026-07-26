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
import { getStatus } from '@/lib/api'

export type ModuleAccess = { enabled: boolean; requireAuth: boolean }

export type HeaderNavModule = 'rankings' | 'pricing'

export const BUILTIN_NAV_KEYS = [
  'home',
  'console',
  'pricing',
  'rankings',
  'docs',
  'about',
] as const

export type BuiltinNavKey = (typeof BUILTIN_NAV_KEYS)[number]

export type HeaderNavModules = {
  home: boolean
  console: boolean
  pricing: ModuleAccess
  rankings: ModuleAccess
  docs: boolean
  about: boolean
  order: BuiltinNavKey[]
  labels: Partial<Record<BuiltinNavKey, string>>
}

const DEFAULT_HEADER_NAV_MODULES: HeaderNavModules = {
  home: true,
  console: true,
  pricing: { enabled: true, requireAuth: false },
  rankings: { enabled: true, requireAuth: false },
  docs: true,
  about: true,
  order: [...BUILTIN_NAV_KEYS],
  labels: {},
}

const DEFAULTS: Record<HeaderNavModule, ModuleAccess> = {
  pricing: DEFAULT_HEADER_NAV_MODULES.pricing,
  rankings: DEFAULT_HEADER_NAV_MODULES.rankings,
}

function cloneHeaderNavDefaults(): HeaderNavModules {
  return {
    ...DEFAULT_HEADER_NAV_MODULES,
    pricing: { ...DEFAULT_HEADER_NAV_MODULES.pricing },
    rankings: { ...DEFAULT_HEADER_NAV_MODULES.rankings },
    order: [...DEFAULT_HEADER_NAV_MODULES.order],
    labels: { ...DEFAULT_HEADER_NAV_MODULES.labels },
  }
}

function isBuiltinNavKey(key: string): key is BuiltinNavKey {
  return (BUILTIN_NAV_KEYS as readonly string[]).includes(key)
}

function parseNavOrder(raw: unknown): BuiltinNavKey[] {
  const order: BuiltinNavKey[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'string') continue
      if (!isBuiltinNavKey(item)) continue
      if (order.includes(item)) continue
      order.push(item)
    }
  }
  for (const key of BUILTIN_NAV_KEYS) {
    if (!order.includes(key)) order.push(key)
  }
  return order
}

function parseNavLabels(raw: unknown): Partial<Record<BuiltinNavKey, string>> {
  const labels: Partial<Record<BuiltinNavKey, string>> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return labels
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isBuiltinNavKey(key)) continue
    if (typeof value !== 'string' || value.trim() === '') continue
    labels[key] = value
  }
  return labels
}

export function parseHeaderNavBoolean(
  raw: unknown,
  fallback: boolean
): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') {
    if (raw === 1) return true
    if (raw === 0) return false
    return fallback
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return fallback
}

function parseAccess(raw: unknown, fallback: ModuleAccess): ModuleAccess {
  if (
    typeof raw === 'boolean' ||
    typeof raw === 'number' ||
    typeof raw === 'string'
  ) {
    return {
      enabled: parseHeaderNavBoolean(raw, fallback.enabled),
      requireAuth: fallback.requireAuth,
    }
  }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    return {
      enabled: parseHeaderNavBoolean(r.enabled, fallback.enabled),
      requireAuth: parseHeaderNavBoolean(r.requireAuth, fallback.requireAuth),
    }
  }
  return { ...fallback }
}

function parseHeaderNavRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || String(raw).trim() === '') return null
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>

  try {
    return JSON.parse(String(raw)) as Record<string, unknown>
  } catch {
    return null
  }
}

export function parseHeaderNavModules(raw: unknown): HeaderNavModules {
  const result = cloneHeaderNavDefaults()
  const parsed = parseHeaderNavRecord(raw)
  if (!parsed) return result

  Object.entries(parsed).forEach(([key, value]) => {
    if (key === 'pricing') {
      result.pricing = parseAccess(value, result.pricing)
      return
    }
    if (key === 'rankings') {
      result.rankings = parseAccess(value, result.rankings)
      return
    }
    if (key === 'order') {
      result.order = parseNavOrder(value)
      return
    }
    if (key === 'labels') {
      result.labels = parseNavLabels(value)
      return
    }

    if (
      key === 'home' ||
      key === 'console' ||
      key === 'docs' ||
      key === 'about'
    ) {
      if (
        typeof value === 'boolean' ||
        typeof value === 'number' ||
        typeof value === 'string'
      ) {
        result[key] = parseHeaderNavBoolean(value, result[key])
      }
    }
  })

  return result
}

export function serializeHeaderNavModules(modules: HeaderNavModules): string {
  return JSON.stringify(modules)
}

export function parseHeaderNavModulesFromStatus(
  status: Record<string, unknown> | null
): HeaderNavModules {
  return parseHeaderNavModules(status?.HeaderNavModules)
}

function getCachedStatus(): Record<string, unknown> | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem('status')
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function cacheStatus(status: Record<string, unknown> | null): void {
  try {
    if (typeof window !== 'undefined' && status) {
      window.localStorage.setItem('status', JSON.stringify(status))
    }
  } catch {
    /* empty */
  }
}

export function getModuleAccessFromStatus(
  status: Record<string, unknown> | null,
  module: HeaderNavModule
): ModuleAccess {
  return parseHeaderNavModulesFromStatus(status)[module] ?? DEFAULTS[module]
}

export function getModuleAccess(module: HeaderNavModule): ModuleAccess {
  return getModuleAccessFromStatus(getCachedStatus(), module)
}

export async function getFreshModuleAccess(
  module: HeaderNavModule
): Promise<ModuleAccess> {
  try {
    const status = (await getStatus()) as Record<string, unknown> | null
    cacheStatus(status)
    return getModuleAccessFromStatus(status, module)
  } catch {
    return { enabled: false, requireAuth: true }
  }
}

export type CustomNavLink = {
  name: string
  url: string
  newWindow: boolean
  enabled: boolean
  requireAuth: boolean
}

const CUSTOM_LINK_URL_PATTERN = /^(https?:\/\/|\/)/

export function parseCustomNavLinks(raw: unknown): CustomNavLink[] {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    if (raw.trim() === '') return []
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []

  const links: CustomNavLink[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.name !== 'string' || r.name.trim() === '') continue
    if (typeof r.url !== 'string' || !CUSTOM_LINK_URL_PATTERN.test(r.url)) {
      continue
    }
    links.push({
      name: r.name,
      url: r.url,
      newWindow: typeof r.newWindow === 'boolean' ? r.newWindow : true,
      enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
      requireAuth: typeof r.requireAuth === 'boolean' ? r.requireAuth : false,
    })
  }
  return links
}

export function parseCustomNavLinksFromStatus(
  status: Record<string, unknown> | null
): CustomNavLink[] {
  return parseCustomNavLinks(status?.HeaderNavCustomLinks)
}

export function serializeCustomNavLinks(links: CustomNavLink[]): string {
  return JSON.stringify(links)
}

export function isSidebarModuleEnabled(
  section: string,
  module: string
): boolean {
  const status = getCachedStatus()
  if (!status) return true

  const raw = status.SidebarModulesAdmin
  if (!raw || String(raw).trim() === '') return true

  try {
    const parsed = JSON.parse(String(raw)) as Record<
      string,
      Record<string, boolean>
    >
    const sectionConfig = parsed[section]
    if (!sectionConfig) return true
    if (sectionConfig.enabled === false) return false
    if (sectionConfig[module] === false) return false
    return true
  } catch {
    return true
  }
}
