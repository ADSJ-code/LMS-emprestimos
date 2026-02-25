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

// Login autentica o usuario e retorna um token JWT
// @Summary Login
// @Description Autentica o usuario com username e password e retorna um token JWT
// @Tags Auth
// @Accept json
// @Produce json
// @Param body body models.LoginRequest true "Credenciais"
// @Success 200 {object} models.LoginResponse
// @Failure 400 {object} models.ErrorResponse
// @Failure 401 {object} models.ErrorResponse
// @Router /auth/login [post]
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
