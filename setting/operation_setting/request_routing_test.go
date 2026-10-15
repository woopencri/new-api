package operation_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequestRoutingSettingValidationAndAtomicUpdate(t *testing.T) {
	previous := GetRequestRoutingSetting()
	t.Cleanup(func() { requestRouting.Store(previous) })
	valid := RequestRoutingSetting{Enabled: true, UnmatchedAction: "reject", Rules: []RequestRoutingRule{
		{Name: "1K", Model: "image", ParamPath: "size", Values: []string{"1920x1080"}, ChannelIDs: []int{1, 2}},
		{Name: "fallback", Model: "image", MatchAll: true, ChannelIDs: []int{3}},
	}}
	raw, err := common.Marshal(valid)
	require.NoError(t, err)
	require.NoError(t, UpdateRequestRoutingSetting(string(raw)))
	assert.Equal(t, valid, *GetRequestRoutingSetting())
	for _, tc := range []struct {
		name   string
		change func(*RequestRoutingSetting)
	}{
		{"unknown unmatched policy", func(s *RequestRoutingSetting) { s.UnmatchedAction = "ignore" }},
		{"empty values cannot become catch-all", func(s *RequestRoutingSetting) { s.Rules[0].Values = nil }},
		{"missing parameter", func(s *RequestRoutingSetting) { s.Rules[0].ParamPath = "" }},
		{"duplicate channel", func(s *RequestRoutingSetting) { s.Rules[0].ChannelIDs = []int{1, 1} }},
		{"negative channel", func(s *RequestRoutingSetting) { s.Rules[0].ChannelIDs = []int{-1} }},
		{"no channels", func(s *RequestRoutingSetting) { s.Rules[0].ChannelIDs = nil }},
		{"duplicate rule name", func(s *RequestRoutingSetting) { s.Rules[1].Name = "1K" }},
		{"unreachable rule after fallback", func(s *RequestRoutingSetting) { s.Rules[0], s.Rules[1] = s.Rules[1], s.Rules[0] }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var config RequestRoutingSetting
			require.NoError(t, common.Unmarshal(raw, &config))
			tc.change(&config)
			invalid, err := common.Marshal(config)
			require.NoError(t, err)
			require.Error(t, UpdateRequestRoutingSetting(string(invalid)))
			assert.Equal(t, valid, *GetRequestRoutingSetting(), "invalid updates must leave the active policy untouched")
		})
	}
	for _, malformed := range []string{"null", "[]", "{}", `{\"rules\":`} {
		_, err := ParseRequestRoutingSetting(malformed)
		assert.Error(t, err)
	}
}
