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
  splitBillingExprAndRequestRules,
  tryParseRequestRuleExpr,
} from './billing-expr'
import { evalExprLocally } from './tier-expr'

describe('billing expression request rules', () => {
  test('separates multiline request multipliers from the token estimator expression', () => {
    const expression = `(tier("base", 0.04 * 1000000))
      * (
        param("size") == "2048x2048"
        ? 2
        : 1
      )
      * (param("size") == "3840x2160" ? 3 : 1)`

    const result = splitBillingExprAndRequestRules(expression)

    assert.equal(result.billingExpr, 'tier("base", 0.04 * 1000000)')
    assert.equal(tryParseRequestRuleExpr(result.requestRuleExpr)?.length, 2)
    assert.doesNotMatch(result.billingExpr, /param\(/)
  })

  test('recognizes a combined expression wrapped in outer parentheses', () => {
    const expression = `(
      (tier("base", 40000))
      * (param("size") == "2160x3840" ? 3 : 1)
    )`

    const result = splitBillingExprAndRequestRules(expression)

    assert.equal(result.billingExpr, 'tier("base", 40000)')
    assert.equal(tryParseRequestRuleExpr(result.requestRuleExpr)?.length, 1)
  })

  test('allows raw param expressions to fall back when no preview request exists', () => {
    const result = evalExprLocally(
      'param("size") == "2048x2048" ? tier("2k", 80000) : tier("base", 40000)',
      0,
      0,
      {
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        cacheCreate1hTokens: 0,
        imageTokens: 0,
        imageOutputTokens: 0,
        audioInputTokens: 0,
        audioOutputTokens: 0,
      }
    )

    assert.equal(result.error, null)
    assert.equal(result.cost, 40000)
    assert.equal(result.matchedTier, 'base')
  })
})
