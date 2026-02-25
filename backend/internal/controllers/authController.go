package controllers

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type AuthController struct {
	service services.AuthService
	logger  *slog.Logger
}

func NewAuthController(s services.AuthService, logger *slog.Logger) *AuthController {
	return &AuthController{service: s, logger: logger}
}

func (ctrl *AuthController) Login(c *gin.Context) {
	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.ShouldBindJSON(&creds); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido"})
		return
	}

	token, err := ctrl.service.Login(c.Request.Context(), creds.Username, creds.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "usuário ou senha incorretos"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"token": token})
}
