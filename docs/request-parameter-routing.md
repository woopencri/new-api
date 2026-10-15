# Request parameter routing

Configure this feature under **System Settings → Model Settings → Request parameter routing**.
It is disabled by default and does not change existing routing until enabled.

Rules match the exact incoming model name, in list order. The first matching rule
limits selection to its channel IDs. Channels must still be enabled, support the
model and endpoint, and belong to a group the request is allowed to use.
Existing priority and weight selection applies **within** the pool.

## Resolution-based image routing

Create three rules for the same request model, using `size` as the parameter path:

| Rule | Matching values (one per line in the UI) | Channels |
| --- | --- | --- |
| 1K | `1024x1024`, `1440x1088`, `1536x1024`, `1088x1440`, `1024x1536`, `1280x720`, `720x1280`, `1920x1080`, `1080x1920` | IDs of your 1K primary and backup channels |
| 2K | `2048x2048`, `2048x1152`, `2048x1536`, `1152x2048`, `1536x2048`, `2560x1440`, `1440x2560` | IDs of your 2K channels |
| 4K | `3840x2160`, `2160x3840` | IDs of your 4K channels |

The client continues to send the same `model`; the router does not rewrite it or
`size`. Configure each channel's existing model mapping if its upstream model name
differs. Billing remains separate: keep the resolution-based billing expression.

### Matching and fallback

- JSON requests support string values at a gjson parameter path (for example,
  `size` or `parameters.size`). Comparisons are exact, including whitespace and
  letter case. Numeric, boolean, null and array values do not match string rules.
  Ambiguous duplicate JSON keys are rejected before parameter matching.
- Multipart image edits and URL-encoded forms match a single top-level form value.
  Duplicate form fields are not matched. Uploaded files and the request body are
  preserved for the relay; file contents are not interpreted as routing fields.
- A fallback rule explicitly enables **Match all parameter values (fallback)**.
  Place it after specific rules for the same model. It also handles missing values.
- For a configured model with no matching rule, choose **Reject the request**
  (the default, HTTP 400) or **Use normal channel selection**. Models with no rules
  always retain ordinary routing.
- A matched rule with no eligible channels fails (HTTP 503). It never falls through
  to another rule or an unrestricted channel. Add backup channel IDs to that rule.
- Retries and automatic group fallback reuse the same per-request channel pool,
  even if routing settings or upstream parameters change during the request.
- An affinity channel outside the pool is ignored. An explicitly specified channel
  outside the pool is rejected (HTTP 403), rather than bypassing the restriction.
- Existing asynchronous tasks remain bound to their original channel for fetches
  and follow-up operations; this feature governs new channel selections.

## Storage and diagnostics

The configuration is stored atomically in the existing options table under
`RequestRoutingSetting`. No new database tables or dialect-specific migrations
are needed. Invalid updates do not overwrite the last valid configuration.

Example option value (replace the model and channel IDs):

```json
{
  "enabled": true,
  "unmatched_action": "reject",
  "rules": [
    {
      "name": "1K",
      "model": "image-model",
      "param_path": "size",
      "values": ["1024x1024", "1920x1080"],
      "channel_ids": [11, 12],
      "match_all": false
    },
    {
      "name": "fallback",
      "model": "image-model",
      "param_path": "size",
      "values": [],
      "channel_ids": [21],
      "match_all": true
    }
  ]
}
```

Text/image consumption and relay error logs record the rule name, original model,
parameter path and allowed channel IDs under `other.admin_info.request_routing`.
The original parameter value is not logged by this feature. Existing non-admin
log filtering strips `admin_info`, keeping internal channel rules private.

Limits: 128 rules, 512 values per rule and 256 channel IDs per rule. Rule names
must be unique; a model's fallback must follow all its specific rules.
