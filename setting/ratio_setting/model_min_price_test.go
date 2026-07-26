package ratio_setting

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetModelMinPrice(t *testing.T) {
	t.Cleanup(func() { modelMinPriceMap.Clear() })

	require.NoError(t, UpdateModelMinPriceByJSONString(`{"gpt-4o-mini": 0.01, "free-model": 0, "negative-model": -0.5}`))

	price, ok := GetModelMinPrice("gpt-4o-mini")
	require.True(t, ok)
	assert.Equal(t, 0.01, price)

	// 未配置的模型
	price, ok = GetModelMinPrice("unknown-model")
	assert.False(t, ok)
	assert.Zero(t, price)

	// 配置为 0 或负值视为未配置（计费安全防线）
	price, ok = GetModelMinPrice("free-model")
	assert.False(t, ok)
	assert.Zero(t, price)

	price, ok = GetModelMinPrice("negative-model")
	assert.False(t, ok)
	assert.Zero(t, price)
}

func TestGetModelMinPriceRejectsNaNAndInf(t *testing.T) {
	t.Cleanup(func() { modelMinPriceMap.Clear() })

	// JSON 无法表达 NaN/Inf，但配置层仍需防御直接写入的非法值
	modelMinPriceMap.Set("nan-model", math.NaN())
	modelMinPriceMap.Set("inf-model", math.Inf(1))

	price, ok := GetModelMinPrice("nan-model")
	assert.False(t, ok)
	assert.Zero(t, price)

	price, ok = GetModelMinPrice("inf-model")
	assert.False(t, ok)
	assert.Zero(t, price)
}

func TestIsGroupMinPriceExempt(t *testing.T) {
	savedMap := groupRatioSetting.MinPriceExemptGroups
	t.Cleanup(func() { groupRatioSetting.MinPriceExemptGroups = savedMap })

	m := types.NewRWMap[string, bool]()
	m.Set("vip", true)
	m.Set("svip", false)
	groupRatioSetting.MinPriceExemptGroups = m

	assert.True(t, IsGroupMinPriceExempt("vip"))
	// 显式 false 与缺失等价：不豁免
	assert.False(t, IsGroupMinPriceExempt("svip"))
	assert.False(t, IsGroupMinPriceExempt("default"))

	// config 反射反序列化可能产生 nil 指针，nil map 视为无豁免
	groupRatioSetting.MinPriceExemptGroups = nil
	assert.False(t, IsGroupMinPriceExempt("vip"))
}

func TestUpdateModelMinPriceByJSONStringRejectsInvalidJSON(t *testing.T) {
	t.Cleanup(func() { modelMinPriceMap.Clear() })

	require.Error(t, UpdateModelMinPriceByJSONString(`not-json`))
	require.Error(t, UpdateModelMinPriceByJSONString(`{"model": "abc"}`))
}
