package service

import (
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

const requestRoutingContextKey = "request_routing_decision"

var ErrRequestRoutingUnmatched = errors.New("no request routing rule matched this model's request parameters")

type RequestRoutingDecision struct {
	Model      string
	Rule       string
	ParamPath  string
	ChannelIDs []int // nil means unrestricted; an empty non-nil slice denies all channels.
	Rejected   bool
}

// PrepareRequestRouting freezes the decision before channel selection and any
// upstream parameter overrides. Retries reuse it even if settings change.
func PrepareRequestRouting(c *gin.Context, modelName string) (*RequestRoutingDecision, error) {
	if existing, ok := c.Get(requestRoutingContextKey); ok {
		decision := existing.(*RequestRoutingDecision)
		if decision.Rejected {
			return decision, ErrRequestRoutingUnmatched
		}
		return decision, nil
	}
	decision := &RequestRoutingDecision{Model: modelName}
	setting := operation_setting.GetRequestRoutingSetting()
	var rules []operation_setting.RequestRoutingRule
	if setting.Enabled {
		for _, rule := range setting.Rules {
			if rule.Model == modelName {
				rules = append(rules, rule)
			}
		}
	}
	if len(rules) == 0 {
		c.Set(requestRoutingContextKey, decision)
		return decision, nil
	}
	// Read only for models governed by a rule; reuse the original body storage.
	var body []byte
	var formValues map[string][]string
	needsBody := !rules[0].MatchAll
	if needsBody {
		switch c.ContentType() {
		case gin.MIMEMultipartPOSTForm:
			form, err := common.ParseMultipartFormReusable(c)
			if err != nil {
				return nil, fmt.Errorf("cannot read routing parameters: %w", err)
			}
			formValues = form.Value
			defer form.RemoveAll()
		case gin.MIMEPOSTForm:
			storage, err := common.GetBodyStorage(c)
			if err != nil {
				return nil, err
			}
			c.Request.Body = io.NopCloser(storage)
			if err := c.Request.ParseForm(); err != nil {
				return nil, err
			}
			formValues = c.Request.PostForm
			if _, err := storage.Seek(0, io.SeekStart); err != nil {
				return nil, err
			}
			c.Request.Body = io.NopCloser(storage)
		default:
			if c.ContentType() == gin.MIMEJSON || strings.HasSuffix(c.ContentType(), "+json") || c.ContentType() == "" {
				storage, err := common.GetBodyStorage(c)
				if err != nil {
					return nil, err
				}
				body, err = storage.Bytes()
				if err != nil {
					return nil, err
				}
				if !gjson.ValidBytes(body) || !routingJSONIsUnambiguous(gjson.ParseBytes(body), 0) {
					return nil, errors.New("invalid or ambiguous JSON request body")
				}
				if _, err := storage.Seek(0, io.SeekStart); err != nil {
					return nil, err
				}
				c.Request.Body = io.NopCloser(storage)
			}
		}
	}
	for _, rule := range rules {
		matched := rule.MatchAll
		if !matched {
			if formValues != nil {
				values := formValues[rule.ParamPath]
				// Ambiguous duplicate form fields must not choose a cheaper pool.
				matched = len(values) == 1 && slices.Contains(rule.Values, values[0])
			} else {
				value := gjson.GetBytes(body, rule.ParamPath)
				matched = value.Type == gjson.String && slices.Contains(rule.Values, value.String())
			}
		}
		if matched {
			decision.Rule = rule.Name
			decision.ParamPath = rule.ParamPath
			decision.ChannelIDs = slices.Clone(rule.ChannelIDs)
			c.Set(requestRoutingContextKey, decision)
			return decision, nil
		}
	}
	if setting.UnmatchedAction == "reject" {
		decision.Rejected = true
		decision.ChannelIDs = []int{}
	}
	c.Set(requestRoutingContextKey, decision)
	if decision.Rejected {
		return decision, ErrRequestRoutingUnmatched
	}
	return decision, nil
}

// Duplicate keys can be interpreted differently by gjson, Go DTOs and upstream
// passthrough providers. Reject them instead of routing and relaying two sizes.
func routingJSONIsUnambiguous(value gjson.Result, depth int) bool {
	if depth > 128 {
		return false
	}
	if !value.IsObject() && !value.IsArray() {
		return true
	}
	valid := true
	keys := make(map[string]bool)
	value.ForEach(func(key, child gjson.Result) bool {
		if value.IsObject() {
			name := key.String()
			if depth == 0 {
				// Go request DTOs also accept case-insensitive field names.
				name = strings.ToLower(name)
			}
			if keys[name] {
				valid = false
				return false
			}
			keys[name] = true
		}
		valid = routingJSONIsUnambiguous(child, depth+1)
		return valid
	})
	return valid
}

func RequestRoutingAllowsChannel(c *gin.Context, channelID int) bool {
	value, ok := c.Get(requestRoutingContextKey)
	if !ok {
		return true
	}
	decision := value.(*RequestRoutingDecision)
	return decision.ChannelIDs == nil || slices.Contains(decision.ChannelIDs, channelID)
}

func AppendRequestRoutingAdminInfo(c *gin.Context, adminInfo map[string]interface{}) {
	value, ok := c.Get(requestRoutingContextKey)
	if !ok || adminInfo == nil {
		return
	}
	decision := value.(*RequestRoutingDecision)
	if decision.Rule == "" {
		return
	}
	adminInfo["request_routing"] = map[string]interface{}{
		"rule": decision.Rule, "model": decision.Model, "param_path": decision.ParamPath, "channel_ids": decision.ChannelIDs,
	}
}
