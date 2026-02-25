package controllers

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type BlacklistController struct {
	service services.BlacklistService
	logger  *slog.Logger
}

func NewBlacklistController(s services.BlacklistService, logger *slog.Logger) *BlacklistController {
	return &BlacklistController{service: s, logger: logger}
}

func (ctrl *BlacklistController) GetBlacklist(c *gin.Context) {
	results, err := ctrl.service.GetAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

func (ctrl *BlacklistController) CreateEntry(c *gin.Context) {
	var entry models.BlacklistEntry
	if err := c.ShouldBindJSON(&entry); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}

	res, err := ctrl.service.Create(c.Request.Context(), entry)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (ctrl *BlacklistController) UpdateEntry(c *gin.Context) {
	id := c.Param("id")
	var entry models.BlacklistEntry
	if err := c.ShouldBindJSON(&entry); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "JSON inválido"})
		return
	}

	res, err := ctrl.service.Update(c.Request.Context(), id, entry)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

func (ctrl *BlacklistController) DeleteEntry(c *gin.Context) {
	id := c.Param("id")
	if err := ctrl.service.Delete(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
