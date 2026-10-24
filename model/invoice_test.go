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
package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/require"
)

func TestCalculateInvoiceFeeUsesConfiguredPercentageAndQuota(t *testing.T) {
	previousEnabled := setting.InvoiceEnabled
	previousPercent := setting.InvoiceFeePercent
	previousMinAmount := setting.InvoiceMinAmount
	previousMode := setting.InvoicePermissionMode
	t.Cleanup(func() {
		setting.InvoiceEnabled = previousEnabled
		setting.InvoiceFeePercent = previousPercent
		setting.InvoiceMinAmount = previousMinAmount
		setting.InvoicePermissionMode = previousMode
	})

	setting.InvoiceEnabled = true
	setting.InvoiceFeePercent = 2.5
	setting.InvoiceMinAmount = 0
	setting.InvoicePermissionMode = "all"

	feeAmount, feeQuota, err := CalculateInvoiceFee(&TopUp{
		Amount: 10000,
		Money:  100,
		Status: common.TopUpStatusSuccess,
	})

	require.NoError(t, err)
	require.Equal(t, 2.5, feeAmount)
	require.Equal(t, 250, feeQuota)
}

func TestUserCanApplyInvoiceRequiresPaidOrderAndMinimumAmount(t *testing.T) {
	previousEnabled := setting.InvoiceEnabled
	previousMinAmount := setting.InvoiceMinAmount
	previousMode := setting.InvoicePermissionMode
	t.Cleanup(func() {
		setting.InvoiceEnabled = previousEnabled
		setting.InvoiceMinAmount = previousMinAmount
		setting.InvoicePermissionMode = previousMode
	})

	setting.InvoiceEnabled = true
	setting.InvoiceMinAmount = 10
	setting.InvoicePermissionMode = "specified"
	user := &User{InvoiceEnabled: true}

	require.False(t, UserCanApplyInvoice(user, &TopUp{Status: common.TopUpStatusPending, Money: 20}))
	require.False(t, UserCanApplyInvoice(user, &TopUp{Status: common.TopUpStatusSuccess, Money: 10}))
	require.True(t, UserCanApplyInvoice(user, &TopUp{Status: common.TopUpStatusSuccess, Money: 10.01}))
}
