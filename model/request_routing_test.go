package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func useRoutingSelectionDB(t *testing.T) *gorm.DB {
	t.Helper()
	oldDB, oldCache, oldType := DB, common.MemoryCacheEnabled, common.MainDatabaseType()
	oldGroups, oldChannels, oldConfigs := group2model2channels, channelsIDM, channel2advancedCustomConfig
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}, &Option{}))
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		DB, common.MemoryCacheEnabled = oldDB, oldCache
		group2model2channels, channelsIDM, channel2advancedCustomConfig = oldGroups, oldChannels, oldConfigs
		common.SetMainDatabaseType(oldType)
		require.NoError(t, sqlDB.Close())
	})
	return db
}

func TestRequestRoutingPoolFiltersBeforePriorityAndPreservesPermissions(t *testing.T) {
	db := useRoutingSelectionDB(t)
	high, low, backup := int64(100), int64(20), int64(10)
	weight := uint(1)
	channels := []Channel{
		{Id: 1, Name: "outside", Key: "test", Type: 1, Status: 1, Group: "default", Models: "image", Priority: &high, Weight: &weight},
		{Id: 2, Name: "1K-primary", Key: "test", Type: 1, Status: 1, Group: "default", Models: "image", Priority: &low, Weight: &weight},
		{Id: 3, Name: "1K-backup", Key: "test", Type: 1, Status: 1, Group: "default", Models: "image", Priority: &backup, Weight: &weight},
		{Id: 4, Name: "other-group", Key: "test", Type: 1, Status: 1, Group: "premium", Models: "image", Priority: &high, Weight: &weight},
		{Id: 5, Name: "disabled", Key: "test", Type: 1, Status: 2, Group: "default", Models: "image", Priority: &high, Weight: &weight},
		{Id: 6, Name: "other-model", Key: "test", Type: 1, Status: 1, Group: "default", Models: "text", Priority: &high, Weight: &weight},
		{Id: 8, Name: "normalized", Key: "test", Type: 1, Status: 1, Group: "default", Models: "gpt-4-gizmo-*", Priority: &low, Weight: &weight},
		{Id: 7, Name: "wrong-path", Key: "test", Type: constant.ChannelTypeAdvancedCustom, Status: 1, Group: "default", Models: "image", Priority: &high, Weight: &weight,
			OtherSettings: `{"advanced_custom":{"advanced_routes":[{"incoming_path":"/v1/chat/completions","upstream_path":"/v1/chat/completions"}]}}`},
	}
	for i := range channels {
		require.NoError(t, db.Create(&channels[i]).Error)
		require.NoError(t, db.Create(&Ability{Group: channels[i].Group, Model: channels[i].Models, ChannelId: channels[i].Id, Enabled: channels[i].Status == 1, Priority: channels[i].Priority, Weight: 1}).Error)
	}
	for _, cache := range []bool{false, true} {
		common.MemoryCacheEnabled = cache
		if cache {
			InitChannelCache()
		}
		channel, err := GetRandomSatisfiedChannel("default", "gpt-4-gizmo-test", 0, "/v1/chat/completions", []int{8})
		require.NoError(t, err)
		require.NotNil(t, channel, "normalized model fallback must work with and without caching")
		assert.Equal(t, 8, channel.Id)
		for _, tc := range []struct {
			name  string
			pool  []int
			retry int
			want  int
		}{
			{"normal routing unchanged", nil, 0, 1},
			{"filter priority before selection", []int{2, 3}, 0, 2},
			{"retry stays in pool", []int{2, 3}, 1, 3},
			{"exhausted retry stays in pool", []int{2, 3}, 9, 3},
			{"group model status path checks", []int{2, 4, 5, 6, 7}, 0, 2},
			{"unauthorized pool has no fallback", []int{4, 5, 6, 7, 999}, 0, 0},
			{"empty pool is not unrestricted", []int{}, 0, 0},
		} {
			t.Run(tc.name+map[bool]string{true: "/cache", false: "/db"}[cache], func(t *testing.T) {
				channel, err := GetRandomSatisfiedChannel("default", "image", tc.retry, "/v1/images/generations", tc.pool)
				require.NoError(t, err)
				if tc.want == 0 {
					assert.Nil(t, channel)
				} else {
					require.NotNil(t, channel)
					assert.Equal(t, tc.want, channel.Id)
				}
			})
		}
	}
}

func TestRequestRoutingOptionRejectsInvalidUpdatesWithoutPersisting(t *testing.T) {
	db := useRoutingSelectionDB(t)
	previous, err := common.Marshal(operation_setting.GetRequestRoutingSetting())
	require.NoError(t, err)
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		require.NoError(t, operation_setting.UpdateRequestRoutingSetting(string(previous)))
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
	})
	require.NoError(t, UpdateOption(operation_setting.RequestRoutingOption, operation_setting.DefaultRequestRouting))
	require.Error(t, UpdateOption(operation_setting.RequestRoutingOption, `{"enabled":true,"unmatched_action":"ignore"}`))
	var option Option
	require.NoError(t, db.Where(&Option{Key: operation_setting.RequestRoutingOption}).First(&option).Error)
	assert.Equal(t, operation_setting.DefaultRequestRouting, option.Value)
	assert.False(t, operation_setting.GetRequestRoutingSetting().Enabled)
	// Invalid startup/synchronization data must retain the last valid in-memory policy.
	assert.Error(t, updateOptionMap(operation_setting.RequestRoutingOption, `null`))
	assert.Equal(t, operation_setting.DefaultRequestRouting, common.OptionMap[operation_setting.RequestRoutingOption])
}
