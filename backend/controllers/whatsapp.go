package controllers

import (
	"encoding/json"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/services"
)

type WhatsappController struct {
	svc services.WhatsappService
}

func NewWhatsappController(s services.WhatsappService) *WhatsappController {
	return &WhatsappController{svc: s}
}

// Enviar msg de texto
func (ctrl *WhatsappController) EnviarMensagem(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserConectado string `json:"user_conectado"`
		Phone         string `json:"phone"`
		Message       string `json:"message"`
		Delay         int    `json:"delay"`
	}

	// Decodificação manual do JSON (sem Gin)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "JSON inválido", http.StatusBadRequest)
		return
	}

	err := ctrl.svc.SendMessage(r.Context(), body.UserConectado, body.Phone, body.Message, body.Delay)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "sucesso"})
}
