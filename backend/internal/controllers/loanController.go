package controllers

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
)

type LoanController struct {
	service services.LoanService
	logger  *slog.Logger
}

func NewLoanController(service services.LoanService, logger *slog.Logger) *LoanController {
	return &LoanController{service: service, logger: logger}
}

func (ctrl *LoanController) GetLoans(c *gin.Context) {
	loans, err := ctrl.service.GetAll(c.Request.Context())
	if err != nil {
		ctrl.logger.Error("erro ao buscar empréstimos", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao buscar dados"})
		return
	}
	c.JSON(http.StatusOK, loans)
}

func (ctrl *LoanController) CreateLoan(c *gin.Context) {
	var loan models.Loan
	if err := c.ShouldBindJSON(&loan); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "formato de dados inválido"})
		return
	}

	createdLoan, err := ctrl.service.Create(c.Request.Context(), loan)
	if err != nil {
		ctrl.logger.Error("erro ao criar empréstimo", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "não foi possível criar o empréstimo"})
		return
	}
	c.JSON(http.StatusCreated, createdLoan)
}

func (ctrl *LoanController) UpdateLoan(c *gin.Context) {
	id := c.Param("id")
	var loan models.Loan

	if err := c.ShouldBindJSON(&loan); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dados inválidos"})
		return
	}

	updatedLoan, err := ctrl.service.Update(c.Request.Context(), id, loan)
	if err != nil {
		ctrl.logger.Error("erro ao atualizar", "id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "falha na atualização"})
		return
	}
	c.JSON(http.StatusOK, updatedLoan)
}

func (ctrl *LoanController) DeleteLoan(c *gin.Context) {
	id := c.Param("id")
	if err := ctrl.service.Delete(c.Request.Context(), id); err != nil {
		ctrl.logger.Error("erro ao deletar", "id", id, "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao remover registro"})
		return
	}
	c.Status(http.StatusNoContent)
}
