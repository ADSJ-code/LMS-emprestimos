package controllers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/models"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/services"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type UsuarioController struct {
	svc services.UsuarioService
}

func NewUsuarioController(s services.UsuarioService) *UsuarioController {
	return &UsuarioController{svc: s}
}

// GET /api/usuarios e POST /api/usuarios
func (ctrl *UsuarioController) UsuariosHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		usuarios, err := ctrl.svc.GetUsuarios()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(usuarios)

	case http.MethodPost:
		var u models.User
		if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
			http.Error(w, "JSON inválido", http.StatusBadRequest)
			return
		}
		if err := ctrl.svc.CreateUsuario(u); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(u)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// GET /api/usuarios/{id}, PUT /api/usuarios/{id}, DELETE /api/usuarios/{id}
func (ctrl *UsuarioController) UsuarioByIDHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	idStr := strings.TrimPrefix(r.URL.Path, "/api/usuarios/")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		http.Error(w, "ID inválido", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		usuario, err := ctrl.svc.GetUsuarioByID(uint(id))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(usuario)

	case http.MethodPut:
		var u models.User
		if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
			http.Error(w, "JSON inválido", http.StatusBadRequest)
			return
		}
		u.ID = primitive.NilObjectID
		if err := ctrl.svc.UpdateUsuario(u); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(u)

	case http.MethodDelete:
		if err := ctrl.svc.DeleteUsuario(uint(id)); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
