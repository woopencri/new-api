package operation_setting

import (
	"fmt"
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
)

const RequestRoutingOption = "RequestRoutingSetting"
const DefaultRequestRouting = `{"enabled":false,"unmatched_action":"reject","rules":[]}`

type RequestRoutingRule struct {
	Name       string   `json:"name"`
	Model      string   `json:"model"`
	ParamPath  string   `json:"param_path"`
	Values     []string `json:"values"`
	ChannelIDs []int    `json:"channel_ids"`
	MatchAll   bool     `json:"match_all"`
}

type RequestRoutingSetting struct {
	Enabled         bool                 `json:"enabled"`
	UnmatchedAction string               `json:"unmatched_action"`
	Rules           []RequestRoutingRule `json:"rules"`
}

var requestRouting atomic.Pointer[RequestRoutingSetting]

func init() {
	requestRouting.Store(&RequestRoutingSetting{UnmatchedAction: "reject", Rules: []RequestRoutingRule{}})
}

// GetRequestRoutingSetting returns an immutable configuration snapshot.
func GetRequestRoutingSetting() *RequestRoutingSetting {
	return requestRouting.Load()
}

func ParseRequestRoutingSetting(raw string) (*RequestRoutingSetting, error) {
	if len(raw) > 1<<20 || !strings.HasPrefix(strings.TrimSpace(raw), "{") {
		return nil, fmt.Errorf("request routing must be a JSON object of at most 1 MiB")
	}
	var setting RequestRoutingSetting
	if err := common.UnmarshalJsonStr(raw, &setting); err != nil {
		return nil, fmt.Errorf("invalid request routing JSON: %w", err)
	}
	if setting.UnmatchedAction != "reject" && setting.UnmatchedAction != "normal" {
		return nil, fmt.Errorf("request routing unmatched_action must be reject or normal")
	}
	if len(setting.Rules) > 128 {
		return nil, fmt.Errorf("request routing supports at most 128 rules")
	}
	names := make(map[string]bool)
	fallbacks := make(map[string]bool)
	for i, rule := range setting.Rules {
		if strings.TrimSpace(rule.Name) == "" || len(rule.Name) > 128 || names[rule.Name] {
			return nil, fmt.Errorf("request routing rule %d needs a unique name of at most 128 bytes", i+1)
		}
		names[rule.Name] = true
		if rule.Model == "" || strings.TrimSpace(rule.Model) != rule.Model || len(rule.Model) > 255 || fallbacks[rule.Model] {
			return nil, fmt.Errorf("request routing rule %d needs a model and must precede that model's fallback", i+1)
		}
		if rule.MatchAll {
			fallbacks[rule.Model] = true
		} else if strings.TrimSpace(rule.ParamPath) == "" || len(rule.ParamPath) > 256 || len(rule.Values) == 0 || len(rule.Values) > 512 {
			return nil, fmt.Errorf("request routing rule %d needs a parameter path and 1 to 512 matching values", i+1)
		}
		for _, value := range rule.Values {
			if value == "" || len(value) > 1024 {
				return nil, fmt.Errorf("request routing rule %d contains an empty or oversized matching value", i+1)
			}
		}
		if len(rule.ChannelIDs) == 0 || len(rule.ChannelIDs) > 256 {
			return nil, fmt.Errorf("request routing rule %d needs 1 to 256 channel IDs", i+1)
		}
		ids := make(map[int]bool)
		for _, id := range rule.ChannelIDs {
			if id <= 0 || id > 2147483647 || ids[id] {
				return nil, fmt.Errorf("request routing rule %d contains an invalid or duplicate channel ID", i+1)
			}
			ids[id] = true
		}
	}
	return &setting, nil
}

func UpdateRequestRoutingSetting(raw string) error {
	setting, err := ParseRequestRoutingSetting(raw)
	if err != nil {
		return err
	}
	requestRouting.Store(setting)
	return nil
}
