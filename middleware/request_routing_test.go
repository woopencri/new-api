package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRequestRoutingDistributorAffinitySpecificChannelsAndRetries(t *testing.T) {
	require.NoError(t, i18n.Init())
	oldDB, oldCache, oldRedis, oldType := model.DB, common.MemoryCacheEnabled, common.RedisEnabled, common.MainDatabaseType()
	oldLogDB, oldLogType := model.LOG_DB, common.LogDatabaseType()
	oldAffinity := *operation_setting.GetChannelAffinitySetting()
	oldRouting, err := common.Marshal(operation_setting.GetRequestRoutingSetting())
	require.NoError(t, err)
	oldAutoGroups, oldUsable := setting.AutoGroups2JsonString(), setting.UserUsableGroups2JSONString()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	model.DB, common.MemoryCacheEnabled, common.RedisEnabled = db, false, false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Setenv("LOG_SQL_DSN", "")
	require.NoError(t, model.InitLogDB())
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		model.DB, common.MemoryCacheEnabled, common.RedisEnabled = oldDB, oldCache, oldRedis
		common.SetMainDatabaseType(oldType)
		model.LOG_DB = oldLogDB
		common.SetLogDatabaseType(oldLogType)
		*operation_setting.GetChannelAffinitySetting() = oldAffinity
		require.NoError(t, operation_setting.UpdateRequestRoutingSetting(string(oldRouting)))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(oldAutoGroups))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(oldUsable))
		require.NoError(t, sqlDB.Close())
	})
	for i, priority := range []int64{100, 20, 10} {
		channel := model.Channel{Id: i + 1, Type: 1, Name: "image", Key: "test", Status: 1, Group: "default", Models: "image", Priority: &priority}
		require.NoError(t, db.Create(&channel).Error)
		require.NoError(t, db.Create(&model.Ability{Group: "default", Model: "image", ChannelId: channel.Id, Enabled: true, Priority: &priority}).Error)
	}
	*operation_setting.GetChannelAffinitySetting() = operation_setting.ChannelAffinitySetting{
		Enabled: true, SwitchOnSuccess: true, DefaultTTLSeconds: 60, MaxEntries: 100,
		Rules: []operation_setting.ChannelAffinityRule{{Name: t.Name(), ModelRegex: []string{"^image$"}, IncludeRuleName: true,
			KeySources: []operation_setting.ChannelAffinityKeySource{{Type: "request_header", Key: "X-Test-Session"}}}},
	}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
		if c.GetHeader("X-Group") != "" {
			common.SetContextKey(c, constant.ContextKeyUsingGroup, c.GetHeader("X-Group"))
		}
		if c.GetHeader("X-Specific") != "" {
			c.Set("specific_channel_id", c.GetHeader("X-Specific"))
		}
		defer common.CleanupBodyStorage(c)
		c.Next()
	}, Distribute())
	router.POST("/v1/images/generations", func(c *gin.Context) {
		body, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		assert.Equal(t, `{"model":"image","size":"1024x1024"}`, string(body))
		if c.GetHeader("X-Test-Retry") == "yes" {
			// Simulate the controller's actual retry entry with the same context.
			retry := 1
			channel, _, err := service.CacheGetRandomSatisfiedChannel(&service.RetryParam{Ctx: c, TokenGroup: "default", ModelName: "image", RequestPath: c.Request.URL.Path, Retry: &retry})
			require.NoError(t, err)
			require.NotNil(t, channel)
			assert.Equal(t, 3, channel.Id)
		}
		c.JSON(http.StatusOK, gin.H{"channel": c.GetInt("channel_id")})
	})
	request := func(specific, group, retry string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(`{"model":"image","size":"1024x1024"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-Session", t.Name())
		req.Header.Set("X-Specific", specific)
		req.Header.Set("X-Group", group)
		req.Header.Set("X-Test-Retry", retry)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}
	require.NoError(t, operation_setting.UpdateRequestRoutingSetting(operation_setting.DefaultRequestRouting))
	assert.JSONEq(t, `{"channel":1}`, request("", "", "").Body.String(), "warm an affinity entry pointing outside the future pool")
	require.NoError(t, operation_setting.UpdateRequestRoutingSetting(`{"enabled":true,"unmatched_action":"reject","rules":[{"name":"1K","model":"image","param_path":"size","values":["1024x1024"],"channel_ids":[2,3]}]}`))
	assert.JSONEq(t, `{"channel":2}`, request("", "", "yes").Body.String(), "affinity must not bypass the pool")
	assert.Equal(t, http.StatusForbidden, request("1", "", "").Code)
	assert.JSONEq(t, `{"channel":2}`, request("2", "", "").Body.String())
	// Skip a group containing only unrelated channels, but retain the same pool.
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["empty","default"]`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"empty":"empty","default":"default"}`))
	assert.JSONEq(t, `{"channel":2}`, request("", "auto", "").Body.String())
	*operation_setting.GetChannelAffinitySetting() = operation_setting.ChannelAffinitySetting{}
	require.NoError(t, db.Model(&model.Ability{}).Where("channel_id IN ?", []int{2, 3}).Update("enabled", false).Error)
	require.NoError(t, db.Model(&model.Channel{}).Where("id IN ?", []int{2, 3}).Update("status", 2).Error)
	assert.Equal(t, http.StatusServiceUnavailable, request("", "", "").Code, "an exhausted pool must not fall back to channel 1")
}
