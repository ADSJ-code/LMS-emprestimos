package controllers

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type AffiliateController struct {
	service services.AffiliateService
	logger  *slog.Logger
}

func NewAffiliateController(s services.AffiliateService, logger *slog.Logger) *AffiliateController {
	return &AffiliateController{service: s, logger: logger}
}

// GetAffiliates lista todos os afiliados
// @Summary Listar afiliados
// @Description Retorna todos os afiliados cadastrados
// @Tags Affiliates
// @Produce json
// @Security BearerAuth
// @Success 200 {array} models.Affiliate
// @Failure 500 {object} models.ErrorResponse
// @Router /affiliates [get]
func (ctrl *AffiliateController) GetAffiliates(c *gin.Context) {
	results, err := ctrl.service.GetAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

// CreateAffiliate cria um novo afiliado
// @Summary Criar afiliado
// @Description Cadastra um novo afiliado
// @Tags Affiliates
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body models.Affiliate true "Dados do afiliado"
// @Success 201 {object} models.Affiliate
// @Failure 400 {object} models.ErrorResponse
// @Failure 500 {object} models.ErrorResponse
// @Router /affiliates [post]
func (ctrl *AffiliateController) CreateAffiliate(c *gin.Context) {
	var aff models.Affiliate
	if err := c.ShouldBindJSON(&aff); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}
	res, err := ctrl.service.Create(c.Request.Context(), aff)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, res)
}

// UpdateAffiliate atualiza um afiliado
// @Summary Atualizar afiliado
// @Description Atualiza os dados de um afiliado pelo ID
// @Tags Affiliates
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "ID do afiliado"
// @Param body body models.Affiliate true "Dados atualizados"
// @Success 200 {object} models.Affiliate
// @Failure 400 {object} models.ErrorResponse
// @Failure 500 {object} models.ErrorResponse
// @Router /affiliates/{id} [put]
func (ctrl *AffiliateController) UpdateAffiliate(c *gin.Context) {
	id := c.Param("id")
	var aff models.Affiliate
	if err := c.ShouldBindJSON(&aff); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}
	res, err := ctrl.service.Update(c.Request.Context(), id, aff)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// DeleteAffiliate remove um afiliado
// @Summary Deletar afiliado
// @Description Remove um afiliado pelo ID
// @Tags Affiliates
// @Security BearerAuth
// @Param id path string true "ID do afiliado"
// @Success 204 "No Content"
// @Failure 500 {object} models.ErrorResponse
// @Router /affiliates/{id} [delete]
func (ctrl *AffiliateController) DeleteAffiliate(c *gin.Context) {
	id := c.Param("id")
	if err := ctrl.service.Delete(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
