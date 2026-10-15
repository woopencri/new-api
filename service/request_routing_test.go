package service

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const routingTestPolicy = `{"enabled":true,"unmatched_action":"reject","rules":[
{"name":"1K","model":"image","param_path":"size","values":["1024x1024","1920x1080","720x1280"],"channel_ids":[11,12]},
{"name":"2K","model":"image","param_path":"size","values":["2560x1440","2048x2048"],"channel_ids":[21]},
{"name":"4K","model":"image","param_path":"size","values":["3840x2160"],"channel_ids":[31]}]}`

func useRequestRoutingPolicy(t *testing.T, raw string) {
	t.Helper()
	previous, err := common.Marshal(operation_setting.GetRequestRoutingSetting())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, operation_setting.UpdateRequestRoutingSetting(string(previous))) })
	require.NoError(t, operation_setting.UpdateRequestRoutingSetting(raw))
}

func newRoutingContext(t *testing.T, body, contentType string) *gin.Context {
	t.Helper()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", contentType)
	t.Cleanup(func() { common.CleanupBodyStorage(c) })
	return c
}

func TestRequestRoutingMatchesDimensionsAndPreservesRequest(t *testing.T) {
	useRequestRoutingPolicy(t, routingTestPolicy)
	for _, tc := range []struct {
		size    string
		channel int
		rule    string
	}{
		{"1024x1024", 11, "1K"}, {"1920x1080", 12, "1K"}, {"720x1280", 11, "1K"},
		{"2560x1440", 21, "2K"}, {"2048x2048", 21, "2K"}, {"3840x2160", 31, "4K"},
	} {
		t.Run(tc.size, func(t *testing.T) {
			body := `{"model":"image","size":"` + tc.size + `","prompt":"keep this"}`
			c := newRoutingContext(t, body, "application/json")
			decision, err := PrepareRequestRouting(c, "image")
			require.NoError(t, err)
			assert.Equal(t, tc.rule, decision.Rule)
			assert.True(t, RequestRoutingAllowsChannel(c, tc.channel))
			assert.False(t, RequestRoutingAllowsChannel(c, 999))
			forwarded, err := io.ReadAll(c.Request.Body)
			require.NoError(t, err)
			assert.Equal(t, body, string(forwarded))
			admin := map[string]interface{}{}
			AppendRequestRoutingAdminInfo(c, admin)
			assert.Equal(t, tc.rule, admin["request_routing"].(map[string]interface{})["rule"])
		})
	}
}

func TestRequestRoutingUnknownMissingAndNonStringValues(t *testing.T) {
	useRequestRoutingPolicy(t, routingTestPolicy)
	for _, body := range []string{`{"size":"auto"}`, `{}`, `{"size":null}`, `{"size":1024}`, `{"size":["1024x1024"]}`} {
		c := newRoutingContext(t, body, "application/json")
		_, err := PrepareRequestRouting(c, "image")
		assert.ErrorIs(t, err, ErrRequestRoutingUnmatched)
		assert.False(t, RequestRoutingAllowsChannel(c, 11))
		_, err = PrepareRequestRouting(c, "image")
		assert.ErrorIs(t, err, ErrRequestRoutingUnmatched, "a frozen rejection must not disappear on retry")
	}
	c := newRoutingContext(t, `not JSON`, "application/json")
	_, err := PrepareRequestRouting(c, "other-model")
	require.NoError(t, err, "unconfigured models must not be affected")
	assert.True(t, RequestRoutingAllowsChannel(c, 999))
}

func TestRequestRoutingFallbackAndExplicitNormalSelection(t *testing.T) {
	useRequestRoutingPolicy(t, strings.Replace(routingTestPolicy, `"reject"`, `"normal"`, 1))
	c := newRoutingContext(t, `{}`, "application/json")
	decision, err := PrepareRequestRouting(c, "image")
	require.NoError(t, err)
	assert.Nil(t, decision.ChannelIDs)
	policy := strings.TrimSuffix(routingTestPolicy, "]}") + `,{"name":"fallback","model":"image","match_all":true,"channel_ids":[41]}]}`
	require.NoError(t, operation_setting.UpdateRequestRoutingSetting(policy))
	missing := newRoutingContext(t, `{}`, "application/json")
	decision, err = PrepareRequestRouting(missing, "image")
	require.NoError(t, err)
	assert.Equal(t, []int{41}, decision.ChannelIDs)
	specific := newRoutingContext(t, `{"size":"1024x1024"}`, "application/json")
	decision, err = PrepareRequestRouting(specific, "image")
	require.NoError(t, err)
	assert.Equal(t, []int{11, 12}, decision.ChannelIDs, "fallback must not override an earlier specific rule")
}

func TestRequestRoutingDecisionIsFrozenAcrossOverridesAndSettingsChanges(t *testing.T) {
	useRequestRoutingPolicy(t, routingTestPolicy)
	c := newRoutingContext(t, `{"size":"1024x1024"}`, "application/json")
	first, err := PrepareRequestRouting(c, "image")
	require.NoError(t, err)
	require.NoError(t, operation_setting.UpdateRequestRoutingSetting(operation_setting.DefaultRequestRouting))
	c.Request.Body = io.NopCloser(strings.NewReader(`{"size":"3840x2160"}`))
	retry, err := PrepareRequestRouting(c, "upstream-mapped-model")
	require.NoError(t, err)
	assert.Equal(t, first.ChannelIDs, retry.ChannelIDs)
	assert.False(t, RequestRoutingAllowsChannel(c, 31))
}

func TestRequestRoutingRejectsAmbiguousDuplicateJSONKeys(t *testing.T) {
	useRequestRoutingPolicy(t, routingTestPolicy)
	for _, body := range []string{
		`{"size":"1024x1024","size":"3840x2160"}`,
		`{"size":"1024x1024","Size":"3840x2160"}`,
		`{"size":"1024x1024","parameters":{"size":"1024x1024","size":"3840x2160"}}`,
	} {
		c := newRoutingContext(t, body, "application/json")
		_, err := PrepareRequestRouting(c, "image")
		require.Error(t, err, "ambiguous keys must not route one size and forward another")
	}
}

func TestRequestRoutingReadsMultipartAndFormWithoutConsumingUploads(t *testing.T) {
	useRequestRoutingPolicy(t, routingTestPolicy)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("size", "1920x1080"))
	file, err := writer.CreateFormFile("image", "image.png")
	require.NoError(t, err)
	_, err = file.Write([]byte("original-image-bytes"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	c := newRoutingContext(t, body.String(), writer.FormDataContentType())
	decision, err := PrepareRequestRouting(c, "image")
	require.NoError(t, err)
	assert.Equal(t, "1K", decision.Rule)
	forwarded, err := io.ReadAll(c.Request.Body)
	require.NoError(t, err)
	assert.Equal(t, body.Bytes(), forwarded)
	for _, form := range []string{"size=1920x1080", "size=1920x1080&size=3840x2160"} {
		c := newRoutingContext(t, form, "application/x-www-form-urlencoded")
		_, err := PrepareRequestRouting(c, "image")
		if strings.Contains(form, "&") {
			assert.ErrorIs(t, err, ErrRequestRoutingUnmatched)
		} else {
			require.NoError(t, err)
		}
		forwarded, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		assert.Equal(t, form, string(forwarded))
	}
}
