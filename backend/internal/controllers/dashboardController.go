package controllers

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type DashboardController struct {
	service services.DashboardService
	logger  *slog.Logger
}

func NewDashboardController(s services.DashboardService, logger *slog.Logger) *DashboardController {
	return &DashboardController{service: s, logger: logger}
}

func (ctrl *DashboardController) GetSummary(c *gin.Context) {
	summary, err := ctrl.service.GetSummary(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao gerar resumo"})
		return
	}
	c.JSON(http.StatusOK, summary)
}
