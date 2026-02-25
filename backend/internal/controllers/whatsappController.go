package controllers

import (
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type WhatsappController struct {
	svc services.WhatsappService
}

func NewWhatsappController(s services.WhatsappService) *WhatsappController {
	return &WhatsappController{svc: s}
}

func (ctrl *WhatsappController) EnviarMensagem(c *gin.Context) {
	var body struct {
		UserConectado string `json:"user_conectado"`
		Phone         string `json:"phone" binding:"required"`
		Message       string `json:"message"`
		Delay         int    `json:"delay"`
	}

	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido. Envie phone e delay_level"})
		return
	}

	err := ctrl.svc.SendMessage(c.Request.Context(), body.UserConectado, body.Phone, body.Message, body.Delay)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "Mensagem enviada com sucesso"})
}
