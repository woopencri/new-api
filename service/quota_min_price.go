// [MIN_PRICE_FEATURE] 底价计算钩子 - 独立于主项目的扩展功能
// 封装底价检查逻辑，供各计费函数调用
package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
)

// ApplyMinPrice 应用底价检查
// 参数：原始quota, 底价(美元), 分组倍率
// 返回：调整后的quota, 是否触发底价
func ApplyMinPrice(quota int, minPrice float64, groupRatio float64) (int, bool) {
	// 没有配置底价或底价为0，直接返回原值
	if minPrice <= 0 {
		return quota, false
	}

	// 计算底价对应的配额: 底价(美元) * 每单位配额 * 分组倍率
	dMinPrice := decimal.NewFromFloat(minPrice)
	dGroupRatio := decimal.NewFromFloat(groupRatio)
	dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)

	minQuota := int(dMinPrice.Mul(dQuotaPerUnit).Mul(dGroupRatio).Round(0).IntPart())

	// 如果原始配额低于底价配额，使用底价
	if quota < minQuota {
		return minQuota, true
	}
	return quota, false
}

// ApplyMinPriceWithLog 应用底价检查并生成日志内容
// 参数：原始quota, 底价(美元), 分组倍率, 现有日志内容
// 返回：调整后的quota, 更新后的日志内容
func ApplyMinPriceWithLog(quota int, minPrice float64, groupRatio float64, logContent string) (int, string) {
	newQuota, triggered := ApplyMinPrice(quota, minPrice, groupRatio)
	if triggered {
		if logContent != "" {
			logContent += ", "
		}
		logContent += "触发底价限制"
	}
	return newQuota, logContent
}

