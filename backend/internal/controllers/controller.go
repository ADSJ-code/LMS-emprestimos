package controllers

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type WelcomeController struct {
	welcomeService services.WelcomeService
	logger         *slog.Logger
}

func NewWelcomeController(ws services.WelcomeService, logger *slog.Logger) *WelcomeController {
	return &WelcomeController{
		welcomeService: ws,
		logger:         logger.With("controller", "welcome"),
	}
}

func (wc *WelcomeController) GetWelcome(c *gin.Context) {
	wc.logger.Info("handling get welcome request")
	message := wc.welcomeService.GetWelcomeMessage()
	c.JSON(http.StatusOK, gin.H{"message": message})
}
