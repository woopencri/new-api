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
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

const sectionCardClassName =
  'relative shadow-sm ring-0 before:pointer-events-none before:absolute before:inset-0 before:rounded-xl before:border before:border-border/90'
const sectionHeaderClassName = 'border-b bg-muted/20'

function safeParseExemptMap(str: string): Record<string, boolean> {
  if (!str || !str.trim()) return {}
  try {
    const parsed = JSON.parse(str) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return {}
    return parsed as Record<string, boolean>
  } catch {
    return {}
  }
}

type MinPriceExemptEditorProps = {
  value: string
  groupOptions: string[]
  onChange: (value: string) => void
}

export function MinPriceExemptEditor({
  value,
  groupOptions,
  onChange,
}: MinPriceExemptEditorProps) {
  const { t } = useTranslation()

  const exemptMap = useMemo(() => safeParseExemptMap(value), [value])

  // Include groups present in the JSON but missing from the current group
  // options, so toggling one switch never drops another group's saved state.
  const allGroups = useMemo(
    () => [...new Set([...groupOptions, ...Object.keys(exemptMap)])],
    [groupOptions, exemptMap]
  )

  const handleToggle = useCallback(
    (group: string, checked: boolean) => {
      const next = { ...exemptMap }
      if (checked) {
        next[group] = true
      } else {
        delete next[group]
      }
      onChange(JSON.stringify(next))
    },
    [exemptMap, onChange]
  )

  return (
    <Card className={sectionCardClassName}>
      <CardHeader className={sectionHeaderClassName}>
        <CardTitle>{t('Minimum charge exemption')}</CardTitle>
        <CardDescription>
          {t('Groups toggled on below skip the per-model minimum charge.')}
        </CardDescription>
      </CardHeader>
      <CardContent className='pt-4'>
        {allGroups.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            {t('No groups configured yet.')}
          </p>
        ) : (
          <div className='divide-y'>
            {allGroups.map((group) => (
              <div
                key={group}
                className='flex items-center justify-between gap-3 py-2.5'
              >
                <span className='min-w-0 truncate text-sm font-medium'>
                  {group}
                </span>
                <Switch
                  checked={exemptMap[group] === true}
                  onCheckedChange={(checked) => handleToggle(group, checked)}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
