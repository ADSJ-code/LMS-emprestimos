package controllers

import (
	"log"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"

	"github.com/gin-gonic/gin"
)

type WhatsappController struct {
	svc services.WhatsappService
}

func NewWhatsappController(s services.WhatsappService) *WhatsappController {
	return &WhatsappController{svc: s}
}

// Enviar msg de texto
func (ctrl *WhatsappController) EnviarMensagem(c *gin.Context) {
	var body struct {
		UserConectado string `json:"user_conectado"`
		Phone      string `json:"phone" binding:"required"`
		Message    string `json:"message"`
		Delay	  int    `json:"delay"`
		Name      string `json:"name"`
		LateDays  int    `json:"lateDays"`
		UpdatedAmount float64 `json:"updatedAmount"`
		DateVencimento string `json:"dateVencimento"`
	}


	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido. Envie phone e delay_level"})
		return
	}

	err := ctrl.svc.SendMessage(c.Request.Context(), body.UserConectado, body.Phone, body.Message, body.Delay, body.Name, body.LateDays, body.UpdatedAmount, body.DateVencimento)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "Mensagem enviada com sucesso"})

}

func (ctrl *WhatsappController) VerInstancias(c *gin.Context) {
	instances, err := ctrl.svc.ViewInstances(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "Instâncias visualizadas com sucesso", "instances": instances})
}

func (ctrl *WhatsappController) CriarInstanciaMsg(c *gin.Context) {
	var body models.CreateInstance
	if err := c.ShouldBindJSON(&body); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido: " + err.Error()})
        return
    }
	
	instance, err := ctrl.svc.CreateInstance(c.Request.Context(), body.Name, body.Phone)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	respMap, ok := instance.(map[string]interface{})
    if ok {
        if _, hasError := respMap["error"]; hasError {
            // Se houver erro na Evolution API, repassamos o status dela
            c.JSON(http.StatusForbidden, gin.H{
                "status": "Falha ao criar instância na API",
                "details": instance,
            })
            return
        }
    }

	c.JSON(http.StatusOK, gin.H{"status": "Instância criada com sucesso", "instance": instance})
}

func (ctrl *WhatsappController) ConectarInstancia(c *gin.Context) {
	var body models.CreateInstance

	log.Println("AQUI")
    if err := c.ShouldBindJSON(&body); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Nome e Número de telefone são obrigatórios"})
        return
    }

    Result, err := ctrl.svc.ConnectInstance(c.Request.Context(), body.Name, body.Phone)
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }
	c.JSON(http.StatusOK, gin.H{"status": "Instância conectada com sucesso", "details": Result})
}
