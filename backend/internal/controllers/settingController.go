package controllers

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type SettingsController struct {
	service services.SettingsService
	logger  *slog.Logger
}

func NewSettingController(s services.SettingsService, logger *slog.Logger) *SettingsController {
	return &SettingsController{service: s, logger: logger}
}

func (ctrl *SettingsController) GetSettings(c *gin.Context) {
	res, err := ctrl.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao carregar configurações"})
		return
	}
	c.JSON(http.StatusOK, res)
}

func (ctrl *SettingsController) SaveSettings(c *gin.Context) {
	var data interface{}
	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}

	res, err := ctrl.service.Update(c.Request.Context(), data)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao salvar configurações"})
		return
	}
	c.JSON(http.StatusOK, res)
}
