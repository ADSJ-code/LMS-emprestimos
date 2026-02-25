package services

import (
	"context"
	"fmt"
	"log"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"go.mongodb.org/mongo-driver/v2/bson"
)

type LoanService interface {
	GetAll(ctx context.Context) ([]models.Loan, error)
	Create(ctx context.Context, l models.Loan) (models.Loan, error)
	Update(ctx context.Context, id string, l models.Loan) (models.Loan, error)
	Delete(ctx context.Context, id string) error
}

type loanService struct{}

func NewLoanService() LoanService { return &loanService{} }

func (s *loanService) GetAll(ctx context.Context) ([]models.Loan, error) {
	var results []models.Loan
	cursor, err := database.MDB().Collection("loans").Find(ctx, bson.M{})
	if err != nil {
		log.Printf("Erro ao buscar no MongoDB: %v", err)
		return nil, err
	}
	defer cursor.Close(ctx)

	if err = cursor.All(ctx, &results); err != nil {
		return nil, err
	}
	if results == nil {
		results = []models.Loan{}
	}
	return results, nil
}

func (s *loanService) Create(ctx context.Context, l models.Loan) (models.Loan, error) {
	if l.History == nil {
		l.History = []models.PaymentRecord{}
	}
	_, err := database.MDB().Collection("loans").InsertOne(ctx, l)
	if err != nil {
		log.Printf("Erro ao inserir no MongoDB: %v", err)
		return l, err
	}
	return l, nil
}

func (s *loanService) Update(ctx context.Context, id string, l models.Loan) (models.Loan, error) {
	fmt.Println("---------------------------------------------------")
	fmt.Printf("PROCESSANDO UPDATE NO SERVICE - ID: %s\n", id)
	fmt.Printf("CLIENTE: %s\n", l.Client)
	fmt.Printf("ITENS NO HISTÓRICO: %d\n", len(l.History))
	for i, h := range l.History {
		fmt.Printf("  [%d] Data: %s | Valor: %.2f | Tipo: %s\n", i, h.Date, h.Amount, h.Type)
	}
	fmt.Println("---------------------------------------------------")

	l.ID = id
	_, err := database.MDB().Collection("loans").ReplaceOne(ctx, bson.M{"id": id}, l)
	if err != nil {
		log.Printf("ERRO AO SALVAR NO MONGO: %v", err)
		return l, err
	}
	return l, nil
}

func (s *loanService) Delete(ctx context.Context, id string) error {
	_, err := database.MDB().Collection("loans").DeleteOne(ctx, bson.M{"id": id})
	return err
}
