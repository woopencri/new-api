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
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	InvoiceStatusPending   = "pending"
	InvoiceStatusCompleted = "completed"
	InvoiceStatusClosed    = "closed"
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
	FeeRefunded  bool    `json:"fee_refunded"`
	AdminHidden  bool    `json:"-" gorm:"index"`
	Version      int     `json:"version" gorm:"default:0"`
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
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	mode := strings.ToLower(strings.TrimSpace(setting.InvoicePermissionMode))
	if mode != "all" {
		mode = "specified"
	}
	fee := setting.InvoiceFeePercent
	minAmount := setting.InvoiceMinAmount
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
	if !config.Enabled || math.IsNaN(topUp.Money) || math.IsInf(topUp.Money, 0) || topUp.Money <= config.MinAmount {
		return false
	}
	if config.PermissionMode != "all" && !user.InvoiceEnabled {
		return false
	}
	// Keep invoice eligibility aligned with the user billing history window.
	if topUp.CreateTime < topUpQueryCutoff() {
		return false
	}
	return true
}

func CalculateInvoiceFee(topUp *TopUp) (feeAmount float64, feeQuota int, err error) {
	if topUp == nil || topUp.Amount <= 0 || topUp.Money <= 0 || math.IsNaN(topUp.Money) || math.IsInf(topUp.Money, 0) {
		return 0, 0, errors.New("订单金额无效")
	}
	config := GetInvoiceConfig()
	if math.IsNaN(config.FeePercent) || math.IsInf(config.FeePercent, 0) || config.FeePercent < 0 || config.FeePercent > 100 || common.QuotaPerUnit <= 0 || math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) {
		return 0, 0, errors.New("开票手续费配置无效")
	}
	ratio := decimal.NewFromFloat(config.FeePercent).Div(decimal.NewFromInt(100))
	feeAmount, _ = decimal.NewFromFloat(topUp.Money).Mul(ratio).Float64()

	// Match the quota actually credited by each payment provider. Most providers
	// store Amount in wallet currency units; Creem already stores raw quota,
	// while Stripe credits Money after applying its group ratio.
	creditedQuota := decimal.NewFromInt(topUp.Amount)
	provider := topUp.PaymentProvider
	if provider == "" {
		provider = topUp.PaymentMethod
	}
	switch provider {
	case PaymentProviderCreem:
	case PaymentProviderStripe:
		creditedQuota = decimal.NewFromFloat(topUp.Money).Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	default:
		creditedQuota = creditedQuota.Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	}
	// Round up to the smallest quota unit so a positive fee cannot become free.
	feeQuota, clamp := common.QuotaFromDecimalChecked(creditedQuota.Mul(ratio).Ceil())
	if clamp != nil {
		return 0, 0, errors.New("开票手续费超出额度范围")
	}
	return feeAmount, feeQuota, nil
}

// IsInvoiceApplicationClosed includes the historical rejected state.
func IsInvoiceApplicationClosed(status string) bool {
	return status == InvoiceStatusClosed || status == InvoiceStatusRejected
}

// refundInvoiceFee refunds the recorded charge inside the caller's transaction.
// The application must be locked and the caller persists FeeRefunded atomically.
func refundInvoiceFee(tx *gorm.DB, user *User, application *InvoiceApplication) (int, error) {
	if application.FeeRefunded {
		return 0, nil
	}
	quota := application.FeeQuota
	if quota < 0 || quota > math.MaxInt32 || user.Quota > math.MaxInt32-quota {
		return 0, errors.New("开票手续费退款超出余额范围")
	}
	if quota > 0 {
		result := tx.Model(&User{}).Where("id = ? AND quota <= ?", user.Id, math.MaxInt32-quota).
			Update("quota", gorm.Expr("quota + ?", quota))
		if result.Error != nil {
			return 0, result.Error
		}
		if result.RowsAffected != 1 {
			return 0, errors.New("开票手续费退款失败，请刷新后重试")
		}
		user.Quota += quota
	}
	application.FeeRefunded = true
	return quota, nil
}

func CreateInvoiceApplication(userId int, topUpId int, buyerName string, taxpayerId string, email string) (*InvoiceApplication, error) {
	buyerName = strings.TrimSpace(buyerName)
	taxpayerId = strings.TrimSpace(taxpayerId)
	email = strings.TrimSpace(email)
	if buyerName == "" || taxpayerId == "" || email == "" {
		return nil, errors.New("请完整填写开票信息")
	}
	var application InvoiceApplication
	quotaDelta := 0
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
			if !IsInvoiceApplicationClosed(existing.Status) {
				return errors.New("该订单已申请开票")
			}
			// Legacy rejected applications were not refunded. Refund their exact
			// recorded charge before collecting the fee for the new application.
			refunded, err := refundInvoiceFee(tx, user, &existing)
			if err != nil {
				return err
			}
			quotaDelta += refunded
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
			result := tx.Model(&User{}).Where("id = ? AND quota >= ?", userId, feeQuota).Update("quota", gorm.Expr("quota - ?", feeQuota))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errors.New("余额不足以支付开票手续费")
			}
		}
		quotaDelta -= feeQuota
		application = InvoiceApplication{
			Id: existing.Id, Version: existing.Version + 1,
			UserId: userId, TopUpId: topUpId, TradeNo: topUp.TradeNo,
			BuyerName: buyerName, TaxpayerId: taxpayerId, Email: email,
			Amount: topUp.Money, FeePercent: GetInvoiceConfig().FeePercent,
			FeeAmount: feeAmount, FeeQuota: feeQuota, Status: InvoiceStatusPending, AdminHidden: false,
			CreateTime: common.GetTimestamp(),
		}
		if existing.Id == 0 {
			return tx.Create(&application).Error
		}
		// Keep one application per order while fencing off stale administrator
		// saves from earlier applications. Closed-at/refund state resets here.
		result := tx.Model(&InvoiceApplication{}).Where("id = ? AND version = ?", existing.Id, existing.Version).
			Select("buyer_name", "taxpayer_id", "email", "amount", "fee_percent", "fee_amount", "fee_quota", "fee_refunded", "admin_hidden", "status", "create_time", "complete_time", "remark", "version").Updates(&application)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("开票申请已更新，请刷新后重试")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if quotaDelta != 0 {
		if err := cacheIncrUserQuota(userId, int64(quotaDelta)); err != nil {
			common.SysLog(fmt.Sprintf("failed to update invoice quota cache for user %d: %s", userId, err.Error()))
		}
	}
	RecordLog(userId, LogTypeSystem, fmt.Sprintf("申请开票，订单号：%s，申请版本：%d，手续费：%.6f，余额额度变动：%d", application.TradeNo, application.Version, application.FeeAmount, quotaDelta))
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
	query := DB.Model(&InvoiceApplication{}).Where("admin_hidden = ?", false)
	if keyword != "" {
		pattern := "%" + strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(keyword, "!", "!!"), "%", "!%"), "_", "!_") + "%"
		query = query.Where("trade_no LIKE ? ESCAPE '!' OR buyer_name LIKE ? ESCAPE '!' OR taxpayer_id LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!'", pattern, pattern, pattern, pattern)
	}
	if IsInvoiceApplicationClosed(status) {
		query = query.Where("status IN ?", []string{InvoiceStatusClosed, InvoiceStatusRejected})
	} else if status != "" {
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

func UpdateInvoiceStatus(id int, status string, remark string, version int) (*InvoiceApplication, error) {
	if IsInvoiceApplicationClosed(status) {
		status = InvoiceStatusClosed
	}
	if status != InvoiceStatusPending && status != InvoiceStatusCompleted && status != InvoiceStatusClosed {
		return nil, errors.New("开票状态无效")
	}
	var application InvoiceApplication
	if err := DB.First(&application, id).Error; err != nil {
		return nil, err
	}
	refunded := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		var topUp TopUp
		if err := lockForUpdate(tx).First(&topUp, application.TopUpId).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).First(&application, id).Error; err != nil {
			return err
		}
		if application.Version != version {
			return errors.New("开票申请已更新，请刷新后重试")
		}
		if IsInvoiceApplicationClosed(application.Status) && status != InvoiceStatusClosed {
			return errors.New("已关闭的申请请由用户重新提交")
		}
		if status == InvoiceStatusClosed && !application.FeeRefunded {
			var user User
			if err := lockForUpdate(tx).First(&user, application.UserId).Error; err != nil {
				return err
			}
			var err error
			refunded, err = refundInvoiceFee(tx, &user, &application)
			if err != nil {
				return err
			}
		}
		if status == InvoiceStatusCompleted && application.Status != InvoiceStatusCompleted {
			application.CompleteTime = common.GetTimestamp()
		} else if status != InvoiceStatusCompleted {
			application.CompleteTime = 0
		}
		application.Status = status
		application.Remark = strings.TrimSpace(remark)
		application.Version++
		result := tx.Model(&InvoiceApplication{}).Where("id = ? AND version = ?", id, version).
			Select("status", "remark", "complete_time", "fee_refunded", "version").Updates(&application)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("开票申请已更新，请刷新后重试")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if refunded > 0 {
		if err := cacheIncrUserQuota(application.UserId, int64(refunded)); err != nil {
			common.SysLog(fmt.Sprintf("failed to refund invoice quota cache for user %d: %s", application.UserId, err.Error()))
		}
	}
	RecordLog(application.UserId, LogTypeSystem, fmt.Sprintf("更新开票申请，订单号：%s，版本：%d，状态：%s，退还手续费额度：%d", application.TradeNo, application.Version, application.Status, refunded))
	return &application, nil
}

// DeleteInvoiceApplication hides a completed or closed application from the
// administrator list. The underlying application remains available to the user
// so their order status and re-application behavior do not change.
func DeleteInvoiceApplication(id int, version int) error {
	if id <= 0 || version < 0 {
		return errors.New("开票申请参数无效")
	}
	var application InvoiceApplication
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&application, id).Error; err != nil {
			return err
		}
		if application.Version != version {
			return errors.New("开票申请已更新，请刷新后重试")
		}
		if application.Status != InvoiceStatusCompleted && !IsInvoiceApplicationClosed(application.Status) {
			return errors.New("只有已完成或已关闭的开票申请可以删除")
		}
		result := tx.Model(&InvoiceApplication{}).
			Where("id = ? AND version = ? AND admin_hidden = ?", id, version, false).
			Updates(map[string]any{
				"admin_hidden": true,
				"version":      gorm.Expr("version + 1"),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("开票申请已更新，请刷新后重试")
		}
		application.AdminHidden = true
		application.Version++
		return nil
	})
	if err != nil {
		return err
	}
	RecordLog(application.UserId, LogTypeSystem, fmt.Sprintf("隐藏开票申请管理记录，订单号：%s，状态：%s", application.TradeNo, application.Status))
	return nil
}

// HideExpiredInvoiceApplications hides completed or closed applications whose
// orders have left the same 30-day window used by the user billing history.
// It deliberately keeps pending applications visible for administrator action.
func HideExpiredInvoiceApplications(ctx context.Context) (int64, error) {
	cutoff := topUpQueryCutoff()
	result := DB.WithContext(ctx).Model(&InvoiceApplication{}).
		Where("admin_hidden = ? AND status IN ? AND top_up_id IN (?)", false, []string{InvoiceStatusCompleted, InvoiceStatusClosed, InvoiceStatusRejected},
			DB.Model(&TopUp{}).Select("id").Where("create_time < ?", cutoff)).
		Updates(map[string]any{
			"admin_hidden": true,
			"version":      gorm.Expr("version + 1"),
		})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
