package handlers

import (
	"fmt"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
)

type WelcomeHandler struct {
	service services.WelcomeService
}

func NewWelcomeHandler(s services.WelcomeService) *WelcomeHandler {
	return &WelcomeHandler{service: s}
}

func (h *WelcomeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	msg := h.service.GetWelcomeMessage()
	fmt.Fprintln(w, msg)
}
