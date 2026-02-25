package controllers

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type UsuarioController struct {
	service services.UsuarioService
	logger  *slog.Logger
}

func NewUsuarioController(service services.UsuarioService, logger *slog.Logger) *UsuarioController {
	return &UsuarioController{service: service, logger: logger}
}

func (uc *UsuarioController) GetUsuarios(c *gin.Context) {
	uc.logger.Info("Buscando lista de usuários")

	usuarios, err := uc.service.GetUsuarios()
	if err != nil {
		uc.logger.Error("Erro ao buscar usuários", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Não foi possível buscar os usuários"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"usuarios": usuarios})
}

func (uc *UsuarioController) GetUsuarioByID(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	usuario, err := uc.service.GetUsuarioByID(uint(id))
	if err != nil {
		uc.logger.Error("Erro ao buscar usuário", "id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Não foi possível obter o usuário"})
		return
	}
	c.JSON(http.StatusOK, usuario)
}

func (uc *UsuarioController) CreateUsuario(c *gin.Context) {
	var in models.Usuario
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Input inválido"})
		return
	}

	if strings.TrimSpace(in.Email) == "" || strings.TrimSpace(in.Senha) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email e senha são obrigatórios"})
		return
	}

	usuario := models.Usuario{
		Nome:     strings.TrimSpace(in.Nome),
		Email:    strings.TrimSpace(in.Email),
		Senha:    in.Senha,
		Telefone: strings.TrimSpace(in.Telefone),
	}

	if err := uc.service.CreateUsuario(usuario); err != nil {
		uc.logger.Error("Erro ao criar usuário", "email", usuario.Email, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Não foi possível criar o usuário"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Usuário criado com sucesso"})
}

func (uc *UsuarioController) UpdateUsuario(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	var in models.Usuario
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Input inválido"})
		return
	}

	in.ID = uint(id)

	if err := uc.service.UpdateUsuario(in); err != nil {
		uc.logger.Error("Erro ao atualizar usuário", "id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Não foi possível atualizar o usuário"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Usuário atualizado com sucesso"})
}

func (uc *UsuarioController) DeleteUsuario(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	if err := uc.service.DeleteUsuario(uint(id)); err != nil {
		uc.logger.Error("Erro ao deletar usuário", "id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Não foi possível deletar o usuário"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Usuário deletado com sucesso"})
}
