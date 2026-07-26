package ratio_setting

import "sync/atomic"

var displayMinPriceEnabled atomic.Bool

func init() {
	displayMinPriceEnabled.Store(false)
}

func SetDisplayMinPriceEnabled(enabled bool) {
	displayMinPriceEnabled.Store(enabled)
}

func IsDisplayMinPriceEnabled() bool {
	return displayMinPriceEnabled.Load()
}
