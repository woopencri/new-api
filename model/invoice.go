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
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"gorm.io/gorm"
)

const (
	InvoiceStatusPending   = "pending"
	InvoiceStatusCompleted = "completed"
	InvoiceStatusRejected  = "rejected"
)

type InvoiceApplication struct {
	Id           int     `json:"id"`
	UserId       int     `json:"user_id" gorm:"index"`
	TopUpId      int     `json:"topup_id" gorm:"uniqueIndex"`
	TradeNo      string  `json:"trade_no" gorm:"index;type:varchar(255)"`
	BuyerName    string  `json:"buyer_name" gorm:"type:varchar(255)"`
	TaxpayerId   string  `json:"taxpayer_id" gorm:"type:varchar(100)"`
	Email        string  `json:"email" gorm:"type:varchar(255)"`
	Amount       float64 `json:"amount"`
	FeePercent   float64 `json:"fee_percent"`
	FeeAmount    float64 `json:"fee_amount"`
	FeeQuota     int     `json:"fee_quota"`
	Status       string  `json:"status" gorm:"type:varchar(32);index"`
	CreateTime   int64   `json:"create_time"`
	CompleteTime int64   `json:"complete_time"`
	Remark       string  `json:"remark" gorm:"type:varchar(500)"`

	User  *User  `json:"user,omitempty" gorm:"-"`
	TopUp *TopUp `json:"top_up,omitempty" gorm:"-"`
}

type InvoiceConfig struct {
	Enabled        bool    `json:"enabled"`
	FeePercent     float64 `json:"fee_percent"`
	MinAmount      float64 `json:"min_amount"`
	PermissionMode string  `json:"permission_mode"`
}

func GetInvoiceConfig() InvoiceConfig {
	mode := strings.ToLower(strings.TrimSpace(setting.InvoicePermissionMode))
	if mode != "all" {
		mode = "specified"
	}
	fee := setting.InvoiceFeePercent
	if fee < 0 || fee > 100 {
		fee = 0
	}
	minAmount := setting.InvoiceMinAmount
	if minAmount < 0 {
		minAmount = 0
	}
	return InvoiceConfig{
		Enabled:        setting.InvoiceEnabled,
		FeePercent:     fee,
		MinAmount:      minAmount,
		PermissionMode: mode,
	}
}

func UserCanApplyInvoice(user *User, topUp *TopUp) bool {
	if user == nil || topUp == nil || topUp.Status != common.TopUpStatusSuccess {
		return false
	}
	config := GetInvoiceConfig()
	if !config.Enabled || topUp.Money <= config.MinAmount {
		return false
	}
	if config.PermissionMode != "all" && !user.InvoiceEnabled {
		return false
	}
	return true
}

func CalculateInvoiceFee(topUp *TopUp) (feeAmount float64, feeQuota int, err error) {
	if topUp == nil || topUp.Amount <= 0 || topUp.Money <= 0 {
		return 0, 0, errors.New("订单金额无效")
	}
	config := GetInvoiceConfig()
	feeAmount = topUp.Money * config.FeePercent / 100
	feeQuota, clamp := common.QuotaRoundChecked(float64(topUp.Amount) * config.FeePercent / 100)
	if clamp != nil {
		return 0, 0, errors.New("开票手续费超出额度范围")
	}
	return feeAmount, feeQuota, nil
}

func CreateInvoiceApplication(userId int, topUpId int, buyerName string, taxpayerId string, email string) (*InvoiceApplication, error) {
	buyerName = strings.TrimSpace(buyerName)
	taxpayerId = strings.TrimSpace(taxpayerId)
	email = strings.TrimSpace(email)
	if buyerName == "" || taxpayerId == "" || email == "" {
		return nil, errors.New("请完整填写开票信息")
	}
	var application InvoiceApplication
	err := DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		if err := lockForUpdate(tx).Where("id = ?", topUpId).First(topUp).Error; err != nil {
			return errors.New("充值订单不存在")
		}
		user := &User{}
		if err := lockForUpdate(tx).Where("id = ?", userId).First(user).Error; err != nil {
			return errors.New("用户不存在")
		}
		if topUp.UserId != userId || !UserCanApplyInvoice(user, topUp) {
			return errors.New("该订单暂不支持申请开票")
		}
		var existing InvoiceApplication
		if err := tx.Where("top_up_id = ?", topUpId).First(&existing).Error; err == nil {
			return errors.New("该订单已申请开票")
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		feeAmount, feeQuota, err := CalculateInvoiceFee(topUp)
		if err != nil {
			return err
		}
		if user.Quota < feeQuota {
			return errors.New("余额不足以支付开票手续费")
		}
		if feeQuota > 0 {
			if err := tx.Model(&User{}).Where("id = ? AND quota >= ?", userId, feeQuota).Update("quota", gorm.Expr("quota - ?", feeQuota)).Error; err != nil {
				return err
			}
		}
		now := common.GetTimestamp()
		application = InvoiceApplication{
			UserId: userId, TopUpId: topUpId, TradeNo: topUp.TradeNo,
			BuyerName: buyerName, TaxpayerId: taxpayerId, Email: email,
			Amount: topUp.Money, FeePercent: GetInvoiceConfig().FeePercent,
			FeeAmount: feeAmount, FeeQuota: feeQuota, Status: InvoiceStatusPending,
			CreateTime: now,
		}
		return tx.Create(&application).Error
	})
	if err != nil {
		return nil, err
	}
	if application.FeeQuota > 0 {
		if err := cacheDecrUserQuota(userId, int64(application.FeeQuota)); err != nil {
			common.SysLog(fmt.Sprintf("failed to decrease invoice fee quota cache for user %d: %s", userId, err.Error()))
		}
	}
	return &application, nil
}

func GetInvoiceByTopUpIDs(topUpIDs []int) (map[int]*InvoiceApplication, error) {
	result := make(map[int]*InvoiceApplication)
	if len(topUpIDs) == 0 {
		return result, nil
	}
	var applications []*InvoiceApplication
	if err := DB.Where("top_up_id IN ?", topUpIDs).Find(&applications).Error; err != nil {
		return nil, err
	}
	for _, application := range applications {
		result[application.TopUpId] = application
	}
	return result, nil
}

func GetUserInvoiceByTopUpID(userId int, topUpId int) (*InvoiceApplication, error) {
	var application InvoiceApplication
	err := DB.Where("user_id = ? AND top_up_id = ?", userId, topUpId).First(&application).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &application, err
}

func ListInvoiceApplications(pageInfo *common.PageInfo, keyword string, status string) ([]*InvoiceApplication, int64, error) {
	query := DB.Model(&InvoiceApplication{})
	if keyword != "" {
		pattern := "%" + strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(keyword, "!", "!!"), "%", "!%"), "_", "!_") + "%"
		query = query.Where("trade_no LIKE ? ESCAPE '!' OR buyer_name LIKE ? ESCAPE '!' OR taxpayer_id LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!'", pattern, pattern, pattern, pattern)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var applications []*InvoiceApplication
	if err := query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&applications).Error; err != nil {
		return nil, 0, err
	}
	for _, application := range applications {
		user := &User{}
		if err := DB.Select("id", "username", "email").Where("id = ?", application.UserId).First(user).Error; err == nil {
			application.User = user
		}
		topUp := &TopUp{}
		if err := DB.Where("id = ?", application.TopUpId).First(topUp).Error; err == nil {
			application.TopUp = topUp
		}
	}
	return applications, total, nil
}

func UpdateInvoiceStatus(id int, status string, remark string) error {
	if status != InvoiceStatusPending && status != InvoiceStatusCompleted && status != InvoiceStatusRejected {
		return errors.New("开票状态无效")
	}
	updates := map[string]interface{}{"status": status, "remark": strings.TrimSpace(remark)}
	if status == InvoiceStatusCompleted {
		updates["complete_time"] = common.GetTimestamp()
	} else {
		updates["complete_time"] = 0
	}
	return DB.Model(&InvoiceApplication{}).Where("id = ?", id).Updates(updates).Error
}
