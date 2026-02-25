package controllers

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type ClientController struct {
	service services.ClientService
	logger  *slog.Logger
}

func NewClientController(s services.ClientService, logger *slog.Logger) *ClientController {
	return &ClientController{service: s, logger: logger}
}

// GetClients lista todos os clientes
// @Summary Listar clientes
// @Description Retorna todos os clientes cadastrados
// @Tags Customers
// @Produce json
// @Security BearerAuth
// @Success 200 {array} models.Client
// @Failure 500 {object} models.ErrorResponse
// @Router /customers [get]
func (ctrl *ClientController) GetClients(c *gin.Context) {
	results, err := ctrl.service.GetAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

// CreateClient cria um novo cliente
// @Summary Criar cliente
// @Description Cadastra um novo cliente
// @Tags Customers
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body models.Client true "Dados do cliente"
// @Success 201 {object} models.Client
// @Failure 400 {object} models.ErrorResponse
// @Failure 500 {object} models.ErrorResponse
// @Router /customers [post]
func (ctrl *ClientController) CreateClient(c *gin.Context) {
	var client models.Client
	if err := c.ShouldBindJSON(&client); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}
	res, err := ctrl.service.Create(c.Request.Context(), client)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, res)
}

// UpdateClient atualiza um cliente
// @Summary Atualizar cliente
// @Description Atualiza os dados de um cliente pelo ID
// @Tags Customers
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "ID do cliente"
// @Param body body models.Client true "Dados atualizados"
// @Success 200 {object} models.Client
// @Failure 400 {object} models.ErrorResponse
// @Failure 500 {object} models.ErrorResponse
// @Router /customers/{id} [put]
func (ctrl *ClientController) UpdateClient(c *gin.Context) {
	idStr := c.Param("id")
	var client models.Client
	if err := c.ShouldBindJSON(&client); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}
	res, err := ctrl.service.Update(c.Request.Context(), idStr, client)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// DeleteClient remove um cliente
// @Summary Deletar cliente
// @Description Remove um cliente pelo ID
// @Tags Customers
// @Security BearerAuth
// @Param id path string true "ID do cliente"
// @Success 204 "No Content"
// @Failure 500 {object} models.ErrorResponse
// @Router /customers/{id} [delete]
func (ctrl *ClientController) DeleteClient(c *gin.Context) {
	idStr := c.Param("id")
	if err := ctrl.service.Delete(c.Request.Context(), idStr); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
