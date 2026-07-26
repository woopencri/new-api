package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupAffRewardTest(t *testing.T) (inviter *User, invitee *User) {
	t.Helper()
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&User{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&User{}).Error)
	})

	paymentSetting := operation_setting.GetPaymentSetting()
	origConfirmed, origVersion := paymentSetting.ComplianceConfirmed, paymentSetting.ComplianceTermsVersion
	origInviter, origInvitee := common.QuotaForInviter, common.QuotaForInvitee
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed, paymentSetting.ComplianceTermsVersion = origConfirmed, origVersion
		common.QuotaForInviter, common.QuotaForInvitee = origInviter, origInvitee
	})
	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	common.QuotaForInviter = 1000
	common.QuotaForInvitee = 500

	inviter = &User{Username: "aff-inviter", Password: "test-password", AffCode: "INV1", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(inviter).Error)
	invitee = &User{Username: "aff-invitee", Password: "test-password", AffCode: "INV2", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, InviterId: inviter.Id, AffPendingReward: true}
	require.NoError(t, DB.Create(invitee).Error)
	return inviter, invitee
}

func TestSettleAffRewardGrantsOnceOnFirstTopup(t *testing.T) {
	inviter, invitee := setupAffRewardTest(t)

	SettleAffReward(invitee.Id)

	var gotInviter, gotInvitee User
	require.NoError(t, DB.First(&gotInviter, "id = ?", inviter.Id).Error)
	require.NoError(t, DB.First(&gotInvitee, "id = ?", invitee.Id).Error)
	assert.Equal(t, 1, gotInviter.AffCount)
	assert.Equal(t, 1000, gotInviter.AffQuota)
	assert.Equal(t, 1000, gotInviter.AffHistoryQuota)
	assert.Equal(t, 500, gotInvitee.Quota)
	assert.False(t, gotInvitee.AffPendingReward)

	// 第二次充值不重复发放
	SettleAffReward(invitee.Id)
	require.NoError(t, DB.First(&gotInviter, "id = ?", inviter.Id).Error)
	require.NoError(t, DB.First(&gotInvitee, "id = ?", invitee.Id).Error)
	assert.Equal(t, 1, gotInviter.AffCount)
	assert.Equal(t, 1000, gotInviter.AffQuota)
	assert.Equal(t, 500, gotInvitee.Quota)
}

func TestSettleAffRewardSkipsWithoutPendingFlag(t *testing.T) {
	inviter, invitee := setupAffRewardTest(t)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Update("aff_pending_reward", false).Error)

	SettleAffReward(invitee.Id)

	var gotInviter User
	require.NoError(t, DB.First(&gotInviter, "id = ?", inviter.Id).Error)
	assert.Zero(t, gotInviter.AffCount)
	assert.Zero(t, gotInviter.AffQuota)
}

func TestSettleAffRewardKeepsPendingWhenComplianceNotConfirmed(t *testing.T) {
	_, invitee := setupAffRewardTest(t)
	operation_setting.GetPaymentSetting().ComplianceConfirmed = false

	SettleAffReward(invitee.Id)

	var gotInvitee User
	require.NoError(t, DB.First(&gotInvitee, "id = ?", invitee.Id).Error)
	assert.True(t, gotInvitee.AffPendingReward, "合规未确认时应保留待发放标记")
	assert.Zero(t, gotInvitee.Quota)
}

func TestSettleAffRewardSkipsUserWithoutInviter(t *testing.T) {
	_, invitee := setupAffRewardTest(t)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Update("inviter_id", 0).Error)

	SettleAffReward(invitee.Id)

	var gotInvitee User
	require.NoError(t, DB.First(&gotInvitee, "id = ?", invitee.Id).Error)
	assert.Zero(t, gotInvitee.Quota)
	assert.True(t, gotInvitee.AffPendingReward)
}
