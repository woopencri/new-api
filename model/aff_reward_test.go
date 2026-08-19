package model

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupAffRewardTest(t *testing.T) (inviter *User, invitee *User) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&User{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&User{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&User{}).Error)
	})
	setting := operation_setting.GetPaymentSetting()
	origConfirmed, origVersion := setting.ComplianceConfirmed, setting.ComplianceTermsVersion
	t.Cleanup(func() { setting.ComplianceConfirmed, setting.ComplianceTermsVersion = origConfirmed, origVersion })
	setting.ComplianceConfirmed = true
	setting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	inviter = &User{Username: "aff-inviter", Password: "test-password", AffCode: "INV1"}
	require.NoError(t, DB.Create(inviter).Error)
	invitee = &User{Username: "aff-invitee", Password: "test-password", AffCode: "INV2", InviterId: inviter.Id, AffPendingReward: true}
	require.NoError(t, DB.Create(invitee).Error)
	return inviter, invitee
}

func TestSettleAffRewardPaysFirstThreeEventsAtTenPercent(t *testing.T) {
	inviter, invitee := setupAffRewardTest(t)
	SettleAffReward(invitee.Id, 1000)
	SettleAffReward(invitee.Id, 2000)
	SettleAffReward(invitee.Id, 3001)
	SettleAffReward(invitee.Id, 4000)

	var gotInviter, gotInvitee User
	require.NoError(t, DB.First(&gotInviter, inviter.Id).Error)
	require.NoError(t, DB.First(&gotInvitee, invitee.Id).Error)
	assert.Equal(t, 1, gotInviter.AffCount)
	assert.Equal(t, 600, gotInviter.AffQuota)
	assert.Equal(t, 600, gotInviter.AffHistoryQuota)
	assert.Equal(t, 3, gotInvitee.AffRebateCount)
	assert.False(t, gotInvitee.AffPendingReward)
}

func TestSettleAffRewardKeepsPendingWhenComplianceNotConfirmed(t *testing.T) {
	_, invitee := setupAffRewardTest(t)
	operation_setting.GetPaymentSetting().ComplianceConfirmed = false
	SettleAffReward(invitee.Id, 1000)
	var got User
	require.NoError(t, DB.First(&got, invitee.Id).Error)
	assert.True(t, got.AffPendingReward)
	assert.Zero(t, got.AffRebateCount)
}

func TestSettleAffRewardSkipsUserWithoutInviter(t *testing.T) {
	_, invitee := setupAffRewardTest(t)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Updates(map[string]interface{}{"inviter_id": 0}).Error)
	SettleAffReward(invitee.Id, 1000)
	var got User
	require.NoError(t, DB.First(&got, invitee.Id).Error)
	assert.Zero(t, got.AffRebateCount)
	assert.True(t, got.AffPendingReward)
}
