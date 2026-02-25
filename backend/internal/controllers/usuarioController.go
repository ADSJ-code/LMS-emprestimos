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

// GetUsuarios lista todos os usuarios
// @Summary Listar usuarios
// @Description Retorna a lista de todos os usuarios cadastrados
// @Tags Users
// @Produce json
// @Security BearerAuth
// @Success 200 {object} models.UsuariosResponse
// @Failure 500 {object} models.ErrorResponse
// @Router /users [get]
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

// GetUsuarioByID busca usuario por ID
// @Summary Buscar usuario por ID
// @Description Retorna um usuario pelo seu ID
// @Tags Users
// @Produce json
// @Security BearerAuth
// @Param id path int true "ID do usuario"
// @Success 200 {object} models.User
// @Failure 400 {object} models.ErrorResponse
// @Failure 500 {object} models.ErrorResponse
// @Router /users/{id} [get]
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

// CreateUsuario cria um novo usuario
// @Summary Criar usuario
// @Description Cadastra um novo usuario no sistema
// @Tags Users
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body models.User true "Dados do usuario"
// @Success 201 {object} models.SuccessMessage
// @Failure 400 {object} models.ErrorResponse
// @Failure 500 {object} models.ErrorResponse
// @Router /users [post]
func (uc *UsuarioController) CreateUsuario(c *gin.Context) {
	var in models.User
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Input inválido"})
		return
	}
	if strings.TrimSpace(in.Username) == "" || strings.TrimSpace(in.Password) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email e senha são obrigatórios"})
		return
	}
	usuario := models.User{
		Nome:     strings.TrimSpace(in.Nome),
		Username: strings.TrimSpace(in.Username),
		Password: in.Password,
		Telefone: strings.TrimSpace(in.Telefone),
	}
	if err := uc.service.CreateUsuario(usuario); err != nil {
		uc.logger.Error("Erro ao criar usuário", "email", usuario.Username, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Não foi possível criar o usuário"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "Usuário criado com sucesso"})
}

// UpdateUsuario atualiza um usuario existente
// @Summary Atualizar usuario
// @Description Atualiza os dados de um usuario pelo ID
// @Tags Users
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "ID do usuario"
// @Param body body models.User true "Dados atualizados"
// @Success 200 {object} models.SuccessMessage
// @Failure 400 {object} models.ErrorResponse
// @Failure 500 {object} models.ErrorResponse
// @Router /users/{id} [put]
func (uc *UsuarioController) UpdateUsuario(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}
	var in models.User
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

// DeleteUsuario remove um usuario
// @Summary Deletar usuario
// @Description Remove um usuario pelo ID
// @Tags Users
// @Produce json
// @Security BearerAuth
// @Param id path int true "ID do usuario"
// @Success 200 {object} models.SuccessMessage
// @Failure 400 {object} models.ErrorResponse
// @Failure 500 {object} models.ErrorResponse
// @Router /users/{id} [delete]
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
