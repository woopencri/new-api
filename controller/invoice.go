/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"math"
	"net/mail"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type invoiceApplicationRequest struct {
	TopUpId    int    `json:"topup_id"`
	BuyerName  string `json:"buyer_name"`
	TaxpayerId string `json:"taxpayer_id"`
	Email      string `json:"email"`
}

type invoiceConfigRequest struct {
	Enabled        bool    `json:"enabled"`
	FeePercent     float64 `json:"fee_percent"`
	MinAmount      float64 `json:"min_amount"`
	PermissionMode string  `json:"permission_mode"`
}

type invoiceStatusRequest struct {
	Version *int   `json:"version"`
	Status  string `json:"status"`
	Remark  string `json:"remark"`
}

func invoiceConfigResponse(user *model.User) gin.H {
	config := model.GetInvoiceConfig()
	return gin.H{
		"enabled":         config.Enabled,
		"fee_percent":     config.FeePercent,
		"min_amount":      config.MinAmount,
		"permission_mode": config.PermissionMode,
		"can_apply":       user != nil && config.Enabled && (config.PermissionMode == "all" || user.InvoiceEnabled),
		"email": func() string {
			if user == nil {
				return ""
			}
			return user.Email
		}(),
	}
}

func GetInvoiceConfig(c *gin.Context) {
	user, err := model.GetUserById(c.GetInt("id"), false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, invoiceConfigResponse(user))
}

func CreateInvoiceApplication(c *gin.Context) {
	var req invoiceApplicationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.TopUpId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	req.BuyerName = strings.TrimSpace(req.BuyerName)
	req.TaxpayerId = strings.TrimSpace(req.TaxpayerId)
	req.Email = strings.TrimSpace(req.Email)
	if req.BuyerName == "" || req.TaxpayerId == "" || req.Email == "" {
		common.ApiErrorMsg(c, "请完整填写开票信息")
		return
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		common.ApiErrorMsg(c, "发票接收邮箱格式不正确")
		return
	}
	application, err := model.CreateInvoiceApplication(c.GetInt("id"), req.TopUpId, req.BuyerName, req.TaxpayerId, req.Email)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, application)
}

func GetAdminInvoiceApplications(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	applications, total, err := model.ListInvoiceApplications(pageInfo, c.Query("keyword"), c.Query("status"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(applications)
	common.ApiSuccess(c, pageInfo)
}

func UpdateAdminInvoiceApplication(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	var req invoiceStatusRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Version == nil || *req.Version < 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	application, err := model.UpdateInvoiceStatus(id, req.Status, req.Remark, *req.Version)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, application)
}

type deleteInvoiceApplicationRequest struct {
	Version *int `json:"version"`
}

func DeleteAdminInvoiceApplication(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	var req deleteInvoiceApplicationRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Version == nil || *req.Version < 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.DeleteInvoiceApplication(id, *req.Version); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, nil)
}

func GetAdminInvoiceConfig(c *gin.Context) {
	common.ApiSuccess(c, invoiceConfigResponse(nil))
}

func UpdateAdminInvoiceConfig(c *gin.Context) {
	var req invoiceConfigRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if math.IsNaN(req.FeePercent) || math.IsInf(req.FeePercent, 0) || math.IsNaN(req.MinAmount) || math.IsInf(req.MinAmount, 0) || req.FeePercent < 0 || req.FeePercent > 100 || req.MinAmount < 0 {
		common.ApiErrorMsg(c, "手续费比例或最低金额无效")
		return
	}
	if req.PermissionMode != "all" && req.PermissionMode != "specified" {
		common.ApiErrorMsg(c, "开票权限选项无效")
		return
	}
	values := map[string]string{
		"InvoiceEnabled":        strconv.FormatBool(req.Enabled),
		"InvoiceFeePercent":     strconv.FormatFloat(req.FeePercent, 'f', -1, 64),
		"InvoiceMinAmount":      strconv.FormatFloat(req.MinAmount, 'f', -1, 64),
		"InvoicePermissionMode": req.PermissionMode,
	}
	if err := model.UpdateOptionsBulk(values); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, invoiceConfigResponse(nil))
}
