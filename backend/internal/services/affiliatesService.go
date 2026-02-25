package services

import (
	"context"
	"strconv"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
)

type AffiliateService interface {
	GetAll(ctx context.Context) ([]models.Affiliate, error)
	Create(ctx context.Context, a models.Affiliate) (models.Affiliate, error)
	Update(ctx context.Context, id string, a models.Affiliate) (models.Affiliate, error)
	Delete(ctx context.Context, id string) error
}

type affiliateService struct{}

func NewAffiliateService() AffiliateService { return &affiliateService{} }

func (s *affiliateService) GetAll(ctx context.Context) ([]models.Affiliate, error) {
	var results []models.Affiliate
	cursor, err := database.MDB().Collection("affiliates").Find(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	if err = cursor.All(ctx, &results); err != nil {
		return nil, err
	}
	if results == nil {
		results = []models.Affiliate{}
	}
	return results, nil
}

func (s *affiliateService) Create(ctx context.Context, a models.Affiliate) (models.Affiliate, error) {
	if a.ID == "" {
		a.ID = strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	_, err := database.MDB().Collection("affiliates").InsertOne(ctx, a)
	return a, err
}

func (s *affiliateService) Update(ctx context.Context, id string, a models.Affiliate) (models.Affiliate, error) {
	a.ID = id
	_, err := database.MDB().Collection("affiliates").ReplaceOne(ctx, bson.M{"id": id}, a)
	return a, err
}

func (s *affiliateService) Delete(ctx context.Context, id string) error {
	_, err := database.MDB().Collection("affiliates").DeleteOne(ctx, bson.M{"id": id})
	return err
}
