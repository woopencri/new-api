// [MIN_PRICE_FEATURE] 底价功能模块 - 独立于主项目的扩展功能
// 当按量计费模型的实际费用低于底价时，按底价收费
package ratio_setting

import (
	"encoding/json"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var (
	modelMinPriceMap      = make(map[string]float64)
	modelMinPriceMapMutex = sync.RWMutex{}
)

// GetModelMinPrice 获取模型底价，返回 (底价美元, 是否存在配置)
func GetModelMinPrice(name string) (float64, bool) {
	modelMinPriceMapMutex.RLock()
	defer modelMinPriceMapMutex.RUnlock()

	name = FormatMatchingModelName(name)
	price, ok := modelMinPriceMap[name]
	return price, ok
}

// UpdateModelMinPriceByJSONString 从 JSON 字符串更新底价配置
func UpdateModelMinPriceByJSONString(jsonStr string) error {
	modelMinPriceMapMutex.Lock()
	defer modelMinPriceMapMutex.Unlock()

	modelMinPriceMap = make(map[string]float64)
	if jsonStr == "" {
		return nil
	}
	err := json.Unmarshal([]byte(jsonStr), &modelMinPriceMap)
	if err == nil {
		InvalidateExposedDataCache()
	}
	return err
}

// ModelMinPrice2JSONString 导出底价配置为 JSON 字符串
func ModelMinPrice2JSONString() string {
	modelMinPriceMapMutex.RLock()
	defer modelMinPriceMapMutex.RUnlock()

	jsonBytes, err := common.Marshal(modelMinPriceMap)
	if err != nil {
		common.SysError("error marshalling model min price: " + err.Error())
		return "{}"
	}
	return string(jsonBytes)
}

// GetModelMinPriceMap 获取底价配置 Map（用于前端展示）
func GetModelMinPriceMap() map[string]float64 {
	modelMinPriceMapMutex.RLock()
	defer modelMinPriceMapMutex.RUnlock()
	return modelMinPriceMap
}

