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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import {
  type BuiltinNavKey,
  parseCustomNavLinksFromStatus,
  parseHeaderNavModulesFromStatus,
} from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export type TopNavLink = {
  title: string
  href: string
  disabled?: boolean
  requiresAuth?: boolean
  external?: boolean
  newTab?: boolean
}

/**
 * Generate top navigation links based on HeaderNavModules configuration from backend /api/status
 * Backend format example (stringified JSON):
 * {
 *   home: true,
 *   console: true,
 *   pricing: { enabled: true, requireAuth: false },
 *   rankings: { enabled: true, requireAuth: false },
 *   docs: true,
 *   about: true
 * }
 */
export function useTopNavLinks(): TopNavLink[] {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { auth } = useAuthStore()

  // Parse HeaderNavModules
  const modules = useMemo(() => {
    return parseHeaderNavModulesFromStatus(
      status as Record<string, unknown> | null
    )
  }, [status])

  const customLinks = useMemo(() => {
    return parseCustomNavLinksFromStatus(
      status as Record<string, unknown> | null
    )
  }, [status])

  // Documentation link (may be external)
  const docsLink: string | undefined = status?.docs_link as string | undefined

  const isAuthed = !!auth?.user

  const links: TopNavLink[] = []

  // Admin-defined labels override the built-in i18n titles
  const title = (key: BuiltinNavKey, fallback: string): string =>
    modules.labels[key] || fallback

  const builtinLinks: Record<BuiltinNavKey, TopNavLink | null> = {
    home:
      modules.home !== false
        ? { title: title('home', t('Home')), href: '/' }
        : null,
    console:
      modules.console !== false
        ? { title: title('console', t('Console')), href: '/dashboard' }
        : null,
    pricing: modules.pricing.enabled
      ? {
          title: title('pricing', t('Model Square')),
          href: '/pricing',
          requiresAuth: modules.pricing.requireAuth && !isAuthed,
        }
      : null,
    rankings: modules.rankings.enabled
      ? {
          title: title('rankings', t('Rankings')),
          href: '/rankings',
          requiresAuth: modules.rankings.requireAuth && !isAuthed,
        }
      : null,
    docs: null,
    about:
      modules.about !== false
        ? { title: title('about', t('About')), href: '/about' }
        : null,
  }

  if (modules.docs !== false) {
    builtinLinks.docs = docsLink
      ? { title: title('docs', t('Docs')), href: docsLink, external: true }
      : { title: title('docs', t('Docs')), href: '/docs' }
  }

  for (const key of modules.order) {
    const link = builtinLinks[key]
    if (link) links.push(link)
  }

  // Admin-defined custom links appended after built-in items
  for (const link of customLinks) {
    if (!link.enabled) continue
    if (link.requireAuth && !isAuthed) continue
    links.push({
      title: link.name,
      href: link.url,
      external: /^https?:\/\//.test(link.url) || link.newWindow,
      newTab: link.newWindow,
    })
  }

  return links
}
