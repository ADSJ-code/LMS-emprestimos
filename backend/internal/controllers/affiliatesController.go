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

func (ctrl *AffiliateController) GetAffiliates(c *gin.Context) {
	results, err := ctrl.service.GetAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

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

func (ctrl *AffiliateController) DeleteAffiliate(c *gin.Context) {
	id := c.Param("id")
	if err := ctrl.service.Delete(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
