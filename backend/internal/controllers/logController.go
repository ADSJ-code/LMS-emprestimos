package controllers

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type LogController struct {
	service services.LogService
	logger  *slog.Logger
}

func NewLogController(s services.LogService, logger *slog.Logger) *LogController {
	return &LogController{service: s, logger: logger}
}

func (ctrl *LogController) GetLogs(c *gin.Context) {
	results, err := ctrl.service.GetAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao carregar logs"})
		return
	}
	c.JSON(http.StatusOK, results)
}
