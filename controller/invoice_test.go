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
package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestInvoiceConfigurationPersistsAndValidates(t *testing.T) {
	previousDB := model.DB
	previousConfig := model.GetInvoiceConfig()
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		setting.InvoiceEnabled = previousConfig.Enabled
		setting.InvoiceFeePercent = previousConfig.FeePercent
		setting.InvoiceMinAmount = previousConfig.MinAmount
		setting.InvoicePermissionMode = previousConfig.PermissionMode
		common.OptionMapRWMutex.Unlock()
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/invoice/admin/config", strings.NewReader(`{"enabled":true,"fee_percent":6,"min_amount":1,"permission_mode":"specified"}`))
	UpdateAdminInvoiceConfig(c)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Enabled        bool    `json:"enabled"`
			FeePercent     float64 `json:"fee_percent"`
			MinAmount      float64 `json:"min_amount"`
			PermissionMode string  `json:"permission_mode"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.True(t, response.Data.Enabled)
	assert.Equal(t, 6.0, response.Data.FeePercent)
	assert.Equal(t, 1.0, response.Data.MinAmount)
	assert.Equal(t, "specified", response.Data.PermissionMode)
	var saved model.Option
	require.NoError(t, db.Where(&model.Option{Key: "InvoiceFeePercent"}).First(&saved).Error)
	assert.Equal(t, "6", saved.Value)
}

func TestClosedInvoiceRefundsFeeAndKeepsOrderAvailableForReapplication(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.InvoiceApplication{}))
	previousConfig := model.GetInvoiceConfig()
	previousQuotaPerUnit := common.QuotaPerUnit
	setting.InvoiceEnabled = true
	setting.InvoicePermissionMode = "all"
	setting.InvoiceFeePercent = 6
	setting.InvoiceMinAmount = 0
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		setting.InvoiceEnabled = previousConfig.Enabled
		setting.InvoicePermissionMode = previousConfig.PermissionMode
		setting.InvoiceFeePercent = previousConfig.FeePercent
		setting.InvoiceMinAmount = previousConfig.MinAmount
		common.QuotaPerUnit = previousQuotaPerUnit
	})
	user := model.User{Username: "closed-invoice-owner", Quota: 1000000}
	require.NoError(t, db.Create(&user).Error)
	order := model.TopUp{UserId: user.Id, Amount: 8, Money: 8, Status: common.TopUpStatusSuccess, TradeNo: "closed-invoice-order", CreateTime: common.GetTimestamp(), CompleteTime: common.GetTimestamp()}
	require.NoError(t, db.Create(&order).Error)
	application, err := model.CreateInvoiceApplication(user.Id, order.Id, "Buyer", "Tax", "invoice@example.com")
	require.NoError(t, err)
	for _, body := range []string{
		`{"status":"closed"}`,
		fmt.Sprintf(`{"status":"closed","version":%d}`, application.Version),
	} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(application.Id)}}
		c.Request = httptest.NewRequest(http.MethodPut, "/api/invoice/admin/applications/1", strings.NewReader(body))
		UpdateAdminInvoiceApplication(c)
		var response struct {
			Success bool                     `json:"success"`
			Data    model.InvoiceApplication `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		if strings.Contains(body, "version") {
			require.True(t, response.Success)
			assert.Equal(t, model.InvoiceStatusClosed, response.Data.Status)
			assert.True(t, response.Data.FeeRefunded)
			assert.Equal(t, application.Version+1, response.Data.Version)
		} else {
			assert.False(t, response.Success)
		}
	}
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, 1000000, user.Quota)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", user.Id)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/user/topup/self", nil)
	GetUserTopUps(c)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.TopUp `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Len(t, response.Data.Items, 1)
	assert.Equal(t, model.InvoiceStatusClosed, response.Data.Items[0].InvoiceStatus)
	assert.True(t, response.Data.Items[0].InvoiceAvailable)
	assert.Equal(t, 240000, response.Data.Items[0].InvoiceFeeQuota)
}

func TestUserTopUpHidesInvoiceDetailsWhenGloballyDisabled(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.InvoiceApplication{}))
	previousConfig := model.GetInvoiceConfig()
	setting.InvoiceEnabled = false
	setting.InvoicePermissionMode = "all"
	t.Cleanup(func() {
		setting.InvoiceEnabled = previousConfig.Enabled
		setting.InvoiceFeePercent = previousConfig.FeePercent
		setting.InvoiceMinAmount = previousConfig.MinAmount
		setting.InvoicePermissionMode = previousConfig.PermissionMode
	})
	user := model.User{Username: "invoice-disabled-user", Quota: 1000000, InvoiceEnabled: true}
	require.NoError(t, db.Create(&user).Error)
	order := model.TopUp{UserId: user.Id, Amount: 8, Money: 8, TradeNo: "invoice-disabled-order", Status: common.TopUpStatusSuccess, CreateTime: common.GetTimestamp()}
	require.NoError(t, db.Create(&order).Error)
	require.NoError(t, db.Create(&model.InvoiceApplication{
		UserId: user.Id, TopUpId: order.Id, TradeNo: order.TradeNo, Status: model.InvoiceStatusCompleted,
	}).Error)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", user.Id)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/user/topup/self", nil)
	GetUserTopUps(c)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.TopUp `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Len(t, response.Data.Items, 1)
	assert.Empty(t, response.Data.Items[0].InvoiceStatus)
	assert.False(t, response.Data.Items[0].InvoiceAvailable)
}
