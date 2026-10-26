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
	"context"
	"errors"
	"fmt"
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupInvoiceTest(t *testing.T) {
	t.Helper()
	previousConfig := GetInvoiceConfig()
	previousQuotaPerUnit := common.QuotaPerUnit
	setting.InvoiceEnabled = true
	setting.InvoiceFeePercent = 6
	setting.InvoiceMinAmount = 0
	setting.InvoicePermissionMode = "specified"
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		setting.InvoiceEnabled = previousConfig.Enabled
		setting.InvoiceFeePercent = previousConfig.FeePercent
		setting.InvoiceMinAmount = previousConfig.MinAmount
		setting.InvoicePermissionMode = previousConfig.PermissionMode
		common.QuotaPerUnit = previousQuotaPerUnit
	})
}

func setupInvoiceDB(t *testing.T) {
	t.Helper()
	setupInvoiceTest(t)
	previousDB, previousLogDB := DB, LOG_DB
	previousRedis := common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &InvoiceApplication{}, &Log{}))
	DB, LOG_DB = db, db
	common.RedisEnabled = false
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.RedisEnabled = previousRedis
		require.NoError(t, sqlDB.Close())
	})
}

func TestCalculateInvoiceFeeUsesCreditedQuota(t *testing.T) {
	setupInvoiceTest(t)
	for _, tc := range []struct {
		name      string
		provider  string
		amount    int64
		money     float64
		wantFee   float64
		wantQuota int
	}{
		{"ten unit order", PaymentProviderEpay, 10, 10, 0.6, 300000},
		{"eight unit order", PaymentProviderEpay, 8, 8, 0.48, 240000},
		{"discounted epay order", PaymentProviderEpay, 10, 8, 0.48, 300000},
		{"stripe group ratio", PaymentProviderStripe, 10, 8, 0.48, 240000},
		{"creem raw quota", PaymentProviderCreem, 5000000, 10, 0.6, 300000},
		{"waffo normalized amount", PaymentProviderWaffo, 10, 10, 0.6, 300000},
		{"pancake normalized amount", PaymentProviderWaffoPancake, 10, 10, 0.6, 300000},
		{"positive fee rounds up", PaymentProviderCreem, 1, 0.01, 0.0006, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fee, quota, err := CalculateInvoiceFee(&TopUp{Amount: tc.amount, Money: tc.money, PaymentProvider: tc.provider})
			require.NoError(t, err)
			assert.Equal(t, tc.wantFee, fee)
			assert.Equal(t, tc.wantQuota, quota)
		})
	}
	// Legacy orders identify providers by payment method only.
	fee, quota, err := CalculateInvoiceFee(&TopUp{Amount: 5000000, Money: 10, PaymentMethod: PaymentMethodCreem})
	require.NoError(t, err)
	assert.Equal(t, 0.6, fee)
	assert.Equal(t, 300000, quota)

	setting.InvoiceFeePercent = 0
	_, quota, err = CalculateInvoiceFee(&TopUp{Amount: 10, Money: 10})
	require.NoError(t, err)
	assert.Zero(t, quota)
}

func TestCalculateInvoiceFeeRejectsUnsafeValues(t *testing.T) {
	setupInvoiceTest(t)
	for _, order := range []*TopUp{
		nil, {Amount: 10, Money: math.NaN()}, {Amount: 10, Money: math.Inf(1)},
		{Amount: math.MaxInt64, Money: 10},
	} {
		_, _, err := CalculateInvoiceFee(order)
		require.Error(t, err)
	}
	for _, invalidUnit := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		common.QuotaPerUnit = invalidUnit
		_, _, err := CalculateInvoiceFee(&TopUp{Amount: 10, Money: 10})
		require.Error(t, err)
	}
	common.QuotaPerUnit = 500000
	setting.InvoiceFeePercent = math.NaN()
	_, _, err := CalculateInvoiceFee(&TopUp{Amount: 10, Money: 10})
	require.Error(t, err)
}

func TestInvoiceEligibilityUsesBillingHistoryWindowAndPermissions(t *testing.T) {
	setupInvoiceTest(t)
	setting.InvoiceMinAmount = 10
	now := common.GetTimestamp()
	user := &User{InvoiceEnabled: true}
	for _, tc := range []struct {
		name    string
		order   TopUp
		allowed bool
	}{
		{"pending", TopUp{Status: common.TopUpStatusPending, Money: 20, CreateTime: now}, false},
		{"equal minimum", TopUp{Status: common.TopUpStatusSuccess, Money: 10, CreateTime: now}, false},
		{"recent order", TopUp{Status: common.TopUpStatusSuccess, Money: 20, CreateTime: now - 29*86400}, true},
		{"just outside billing window", TopUp{Status: common.TopUpStatusSuccess, Money: 20, CreateTime: now - 31*86400}, false},
		{"completion time does not extend window", TopUp{Status: common.TopUpStatusSuccess, Money: 20, CreateTime: now - 31*86400, CompleteTime: now}, false},
		{"missing creation timestamp", TopUp{Status: common.TopUpStatusSuccess, Money: 20}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.allowed, UserCanApplyInvoice(user, &tc.order))
		})
	}
	user.InvoiceEnabled = false
	assert.False(t, UserCanApplyInvoice(user, &TopUp{Status: common.TopUpStatusSuccess, Money: 20, CreateTime: now}))
	setting.InvoicePermissionMode = "all"
	assert.True(t, UserCanApplyInvoice(user, &TopUp{Status: common.TopUpStatusSuccess, Money: 20, CreateTime: now}))
	setting.InvoiceEnabled = false
	assert.False(t, UserCanApplyInvoice(user, &TopUp{Status: common.TopUpStatusSuccess, Money: 20, CreateTime: now}))
}

func TestInvoiceApplicationDebitsDatabaseAndCacheOnlyOnce(t *testing.T) {
	setupInvoiceDB(t)
	useUserCacheMiniRedis(t)
	user := User{Username: "invoice-user", InvoiceEnabled: true, Quota: 1000000, AuthVersion: 1}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))
	order := TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: "invoice-paid", Status: common.TopUpStatusSuccess, CreateTime: common.GetTimestamp()}
	require.NoError(t, DB.Create(&order).Error)
	application, err := CreateInvoiceApplication(user.Id, order.Id, "Buyer", "Tax-ID", "invoice@example.com")
	require.NoError(t, err)
	assert.Equal(t, 0.48, application.FeeAmount)
	assert.Equal(t, 240000, application.FeeQuota)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 760000, user.Quota)
	cached, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 760000, cached.Quota)
	_, err = CreateInvoiceApplication(user.Id, order.Id, "Buyer", "Tax-ID", "invoice@example.com")
	require.ErrorContains(t, err, "已申请")
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 760000, user.Quota)
	var count int64
	require.NoError(t, DB.Model(&InvoiceApplication{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestInvoiceApplicationFailureLeavesBalanceUntouched(t *testing.T) {
	for _, scenario := range []string{"insufficient balance", "expired", "another user", "insert failure"} {
		t.Run(scenario, func(t *testing.T) {
			setupInvoiceDB(t)
			user := User{Username: "invoice-failure", InvoiceEnabled: true, Quota: 1000000}
			require.NoError(t, DB.Create(&user).Error)
			order := TopUp{UserId: user.Id, Amount: 10, Money: 10, TradeNo: "invoice-failure-order", Status: common.TopUpStatusSuccess, CompleteTime: common.GetTimestamp()}
			switch scenario {
			case "insufficient balance":
				user.Quota = 299999
				require.NoError(t, DB.Model(&user).Update("quota", user.Quota).Error)
			case "expired":
			case "another user":
				order.UserId = user.Id + 1
			case "insert failure":
				require.NoError(t, DB.Callback().Create().Before("gorm:create").Register("test:invoice_insert_failure", func(tx *gorm.DB) {
					if tx.Statement.Table == "invoice_applications" {
						tx.AddError(errors.New("invoice insert failed"))
					}
				}))
			}
			require.NoError(t, DB.Create(&order).Error)
			_, err := CreateInvoiceApplication(user.Id, order.Id, "Buyer", "Tax-ID", "invoice@example.com")
			require.Error(t, err)
			var persisted User
			require.NoError(t, DB.First(&persisted, user.Id).Error)
			assert.Equal(t, user.Quota, persisted.Quota)
			var count int64
			require.NoError(t, DB.Model(&InvoiceApplication{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestInvoiceCloseRefundsExactChargeAndAllowsFreshApplication(t *testing.T) {
	setupInvoiceDB(t)
	useUserCacheMiniRedis(t)
	user := User{Username: "invoice-close", InvoiceEnabled: true, Quota: 1000000, AuthVersion: 1}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))
	order := TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: "close-order", Status: common.TopUpStatusSuccess, CreateTime: common.GetTimestamp()}
	require.NoError(t, DB.Create(&order).Error)
	application, err := CreateInvoiceApplication(user.Id, order.Id, "Original buyer", "Original tax ID", "original@example.com")
	require.NoError(t, err)
	initialVersion := application.Version
	setting.InvoiceFeePercent = 99
	closed, err := UpdateInvoiceStatus(application.Id, InvoiceStatusClosed, "Closed by admin", application.Version)
	require.NoError(t, err)
	assert.Equal(t, InvoiceStatusClosed, closed.Status)
	assert.True(t, closed.FeeRefunded)
	assert.Equal(t, 240000, closed.FeeQuota)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 1000000, user.Quota)
	cached, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 1000000, cached.Quota)

	_, err = UpdateInvoiceStatus(application.Id, InvoiceStatusClosed, "duplicate stale save", initialVersion)
	require.ErrorContains(t, err, "已更新")
	closed, err = UpdateInvoiceStatus(application.Id, InvoiceStatusClosed, "repeat close", closed.Version)
	require.NoError(t, err)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 1000000, user.Quota)
	_, err = UpdateInvoiceStatus(application.Id, InvoiceStatusPending, "cannot reopen a refunded application", closed.Version)
	require.ErrorContains(t, err, "重新提交")

	setting.InvoiceFeePercent = 6
	resubmitted, err := CreateInvoiceApplication(user.Id, order.Id, "New buyer", "New tax ID", "new@example.com")
	require.NoError(t, err)
	assert.Equal(t, application.Id, resubmitted.Id)
	assert.Equal(t, InvoiceStatusPending, resubmitted.Status)
	assert.Equal(t, "New buyer", resubmitted.BuyerName)
	assert.False(t, resubmitted.FeeRefunded)
	assert.Empty(t, resubmitted.Remark)
	assert.Zero(t, resubmitted.CompleteTime)
	var persistedApplication InvoiceApplication
	require.NoError(t, DB.First(&persistedApplication, resubmitted.Id).Error)
	assert.Equal(t, "New buyer", persistedApplication.BuyerName)
	assert.Equal(t, "New tax ID", persistedApplication.TaxpayerId)
	assert.Equal(t, "new@example.com", persistedApplication.Email)
	assert.False(t, persistedApplication.FeeRefunded)
	assert.Equal(t, InvoiceStatusPending, persistedApplication.Status)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 760000, user.Quota)
	cached, err = GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 760000, cached.Quota)
	_, err = UpdateInvoiceStatus(application.Id, InvoiceStatusClosed, "stale previous application", closed.Version)
	require.ErrorContains(t, err, "已更新")
	completed, err := UpdateInvoiceStatus(application.Id, InvoiceStatusCompleted, "Done", resubmitted.Version)
	require.NoError(t, err)
	assert.Positive(t, completed.CompleteTime)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 760000, user.Quota)
	_, err = UpdateInvoiceStatus(application.Id, InvoiceStatusClosed, "second application closed", completed.Version)
	require.NoError(t, err)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 1000000, user.Quota)
	var count int64
	require.NoError(t, DB.Model(&InvoiceApplication{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestLegacyRejectedInvoiceCanBeClosedOrResubmittedWithoutLosingRefund(t *testing.T) {
	for _, action := range []string{"close", "resubmit"} {
		t.Run(action, func(t *testing.T) {
			setupInvoiceDB(t)
			user := User{Username: "legacy-invoice", InvoiceEnabled: true, Quota: 999999}
			require.NoError(t, DB.Create(&user).Error)
			order := TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: "legacy-order", Status: common.TopUpStatusSuccess, CreateTime: common.GetTimestamp()}
			require.NoError(t, DB.Create(&order).Error)
			legacy := InvoiceApplication{UserId: user.Id, TopUpId: order.Id, TradeNo: order.TradeNo, FeeQuota: 1, Status: InvoiceStatusRejected}
			require.NoError(t, DB.Create(&legacy).Error)
			applications, total, err := ListInvoiceApplications(&common.PageInfo{Page: 1, PageSize: 10}, "", InvoiceStatusClosed)
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			require.Len(t, applications, 1)
			assert.Equal(t, legacy.Id, applications[0].Id)
			if action == "close" {
				updated, err := UpdateInvoiceStatus(legacy.Id, InvoiceStatusClosed, "", legacy.Version)
				require.NoError(t, err)
				assert.True(t, updated.FeeRefunded)
				require.NoError(t, DB.First(&user, user.Id).Error)
				assert.Equal(t, 1000000, user.Quota)
			} else {
				application, err := CreateInvoiceApplication(user.Id, order.Id, "Buyer", "Tax", "buyer@example.com")
				require.NoError(t, err)
				assert.Equal(t, legacy.Id, application.Id)
				assert.False(t, application.FeeRefunded)
				require.NoError(t, DB.First(&user, user.Id).Error)
				assert.Equal(t, 760000, user.Quota)
			}
		})
	}
}

func TestInvoiceRefundRollsBackWhenStatusWriteFails(t *testing.T) {
	setupInvoiceDB(t)
	useUserCacheMiniRedis(t)
	user := User{Username: "invoice-refund-rollback", InvoiceEnabled: true, Quota: 1000000, AuthVersion: 1}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))
	order := TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: "refund-rollback", Status: common.TopUpStatusSuccess, CreateTime: common.GetTimestamp()}
	require.NoError(t, DB.Create(&order).Error)
	application, err := CreateInvoiceApplication(user.Id, order.Id, "Buyer", "Tax", "buyer@example.com")
	require.NoError(t, err)
	require.NoError(t, DB.Callback().Update().Before("gorm:update").Register("test:invoice_status_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "invoice_applications" {
			tx.AddError(errors.New("invoice status write failed"))
		}
	}))
	_, err = UpdateInvoiceStatus(application.Id, InvoiceStatusClosed, "", application.Version)
	require.ErrorContains(t, err, "status write failed")
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 760000, user.Quota)
	cached, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 760000, cached.Quota)
	var persisted InvoiceApplication
	require.NoError(t, DB.First(&persisted, application.Id).Error)
	assert.Equal(t, InvoiceStatusPending, persisted.Status)
	assert.False(t, persisted.FeeRefunded)
	assert.Equal(t, application.Version, persisted.Version)
}

func TestInvoiceRefundRejectsBalanceOverflow(t *testing.T) {
	setupInvoiceDB(t)
	user := User{Username: "invoice-refund-overflow", Quota: int(^uint(0) >> 1)}
	require.NoError(t, DB.Create(&user).Error)
	order := TopUp{UserId: user.Id, TradeNo: "refund-overflow", Status: common.TopUpStatusSuccess}
	require.NoError(t, DB.Create(&order).Error)
	application := InvoiceApplication{UserId: user.Id, TopUpId: order.Id, FeeQuota: 1, Status: InvoiceStatusPending}
	require.NoError(t, DB.Create(&application).Error)
	_, err := UpdateInvoiceStatus(application.Id, InvoiceStatusClosed, "", application.Version)
	require.ErrorContains(t, err, "超出余额范围")
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, int(^uint(0)>>1), user.Quota)
}

func TestInvoiceRefundAllowsSQLiteQuotaAboveLegacyInt32Limit(t *testing.T) {
	setupInvoiceDB(t)
	user := User{Username: "invoice-refund-sqlite-large-quota", Quota: common.MaxQuota + 100, AuthVersion: 1}
	require.NoError(t, DB.Create(&user).Error)
	order := TopUp{UserId: user.Id, TradeNo: "refund-sqlite-large-quota", Status: common.TopUpStatusSuccess}
	require.NoError(t, DB.Create(&order).Error)
	application := InvoiceApplication{UserId: user.Id, TopUpId: order.Id, FeeQuota: 1, Status: InvoiceStatusPending}
	require.NoError(t, DB.Create(&application).Error)
	updated, err := UpdateInvoiceStatus(application.Id, InvoiceStatusClosed, "", application.Version)
	require.NoError(t, err)
	assert.True(t, updated.FeeRefunded)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, common.MaxQuota+101, user.Quota)
}

func TestConcurrentInvoiceCloseRefundsFeeOnlyOnce(t *testing.T) {
	setupInvoiceDB(t)
	useUserCacheMiniRedis(t)
	user := User{Username: "invoice-concurrent-close", InvoiceEnabled: true, Quota: 1000000, AuthVersion: 1}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, populateUserCache(user))
	order := TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: "concurrent-close-order", Status: common.TopUpStatusSuccess, CreateTime: common.GetTimestamp()}
	require.NoError(t, DB.Create(&order).Error)
	application, err := CreateInvoiceApplication(user.Id, order.Id, "Buyer", "Tax", "buyer@example.com")
	require.NoError(t, err)
	start := make(chan struct{})
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			_, err := UpdateInvoiceStatus(application.Id, InvoiceStatusClosed, "", application.Version)
			results <- err
		}()
	}
	close(start)
	first, second := <-results, <-results
	if first == nil {
		require.ErrorContains(t, second, "已更新")
	} else {
		require.ErrorContains(t, first, "已更新")
		require.NoError(t, second)
	}
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 1000000, user.Quota)
	cached, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 1000000, cached.Quota)
}

func TestInvoiceAdminDeleteHidesRecordWithoutChangingUserApplication(t *testing.T) {
	setupInvoiceDB(t)
	user := User{Username: "invoice-delete-user", InvoiceEnabled: true, Quota: 1000000}
	require.NoError(t, DB.Create(&user).Error)
	initialQuota := user.Quota
	statuses := []string{InvoiceStatusCompleted, InvoiceStatusClosed}
	for index, status := range statuses {
		order := TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: fmt.Sprintf("delete-order-%d", index), Status: common.TopUpStatusSuccess, CreateTime: common.GetTimestamp()}
		require.NoError(t, DB.Create(&order).Error)
		application := InvoiceApplication{UserId: user.Id, TopUpId: order.Id, TradeNo: order.TradeNo, Status: status, FeeQuota: 240000, Version: 3, CreateTime: common.GetTimestamp()}
		require.NoError(t, DB.Create(&application).Error)
		require.NoError(t, DeleteInvoiceApplication(application.Id, application.Version))
		var persisted InvoiceApplication
		require.NoError(t, DB.First(&persisted, application.Id).Error)
		assert.True(t, persisted.AdminHidden)
		assert.Equal(t, status, persisted.Status)
		assert.Equal(t, application.Version+1, persisted.Version)
		byOrder, err := GetInvoiceByTopUpIDs([]int{order.Id})
		require.NoError(t, err)
		assert.Equal(t, status, byOrder[order.Id].Status)
		var persistedUser User
		require.NoError(t, DB.First(&persistedUser, user.Id).Error)
		assert.Equal(t, initialQuota, persistedUser.Quota)
		_, total, err := ListInvoiceApplications(&common.PageInfo{Page: 1, PageSize: 10}, "", "")
		require.NoError(t, err)
		assert.Zero(t, total)
	}
}

func TestInvoiceAdminDeleteRejectsPendingAndStaleVersion(t *testing.T) {
	setupInvoiceDB(t)
	application := InvoiceApplication{Status: InvoiceStatusPending, Version: 2, TradeNo: "pending-delete"}
	require.NoError(t, DB.Create(&application).Error)
	err := DeleteInvoiceApplication(application.Id, application.Version)
	require.ErrorContains(t, err, "已完成或已关闭")
	err = DeleteInvoiceApplication(application.Id, application.Version-1)
	require.ErrorContains(t, err, "已更新")
	var persisted InvoiceApplication
	require.NoError(t, DB.First(&persisted, application.Id).Error)
	assert.False(t, persisted.AdminHidden)
}

func TestHideExpiredInvoiceApplicationsKeepsPendingAndUserRecord(t *testing.T) {
	setupInvoiceDB(t)
	user := User{Username: "invoice-cleanup-user", InvoiceEnabled: true}
	require.NoError(t, DB.Create(&user).Error)
	now := common.GetTimestamp()
	oldOrder := TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: "old-completed", Status: common.TopUpStatusSuccess, CreateTime: now - 31*86400}
	pendingOrder := TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: "old-pending", Status: common.TopUpStatusSuccess, CreateTime: now - 31*86400}
	recentOrder := TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: "recent-completed", Status: common.TopUpStatusSuccess, CreateTime: now}
	require.NoError(t, DB.Create(&oldOrder).Error)
	require.NoError(t, DB.Create(&pendingOrder).Error)
	require.NoError(t, DB.Create(&recentOrder).Error)

	oldApplication := InvoiceApplication{UserId: user.Id, TopUpId: oldOrder.Id, TradeNo: oldOrder.TradeNo, Status: InvoiceStatusCompleted}
	pendingApplication := InvoiceApplication{UserId: user.Id, TopUpId: pendingOrder.Id, TradeNo: pendingOrder.TradeNo, Status: InvoiceStatusPending}
	recentApplication := InvoiceApplication{UserId: user.Id, TopUpId: recentOrder.Id, TradeNo: recentOrder.TradeNo, Status: InvoiceStatusClosed}
	require.NoError(t, DB.Create(&oldApplication).Error)
	require.NoError(t, DB.Create(&pendingApplication).Error)
	require.NoError(t, DB.Create(&recentApplication).Error)
	hidden, err := HideExpiredInvoiceApplications(context.Background())
	require.NoError(t, err)
	assert.EqualValues(t, 1, hidden)
	var oldPersisted InvoiceApplication
	require.NoError(t, DB.First(&oldPersisted, oldApplication.Id).Error)
	assert.True(t, oldPersisted.AdminHidden)
	var pendingPersisted InvoiceApplication
	require.NoError(t, DB.First(&pendingPersisted, pendingApplication.Id).Error)
	assert.False(t, pendingPersisted.AdminHidden)
	var recentPersisted InvoiceApplication
	require.NoError(t, DB.First(&recentPersisted, recentApplication.Id).Error)
	assert.False(t, recentPersisted.AdminHidden)
	byOrder, err := GetInvoiceByTopUpIDs([]int{oldOrder.Id})
	require.NoError(t, err)
	assert.Equal(t, InvoiceStatusCompleted, byOrder[oldOrder.Id].Status)
	var persistedUser User
	require.NoError(t, DB.First(&persistedUser, user.Id).Error)
	assert.Zero(t, persistedUser.Quota)
}
