package services

import (
	"context"
	"strconv"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
)

type BlacklistService interface {
	GetAll(ctx context.Context) ([]models.BlacklistEntry, error)
	Create(ctx context.Context, b models.BlacklistEntry) (models.BlacklistEntry, error)
	Update(ctx context.Context, id string, b models.BlacklistEntry) (models.BlacklistEntry, error)
	Delete(ctx context.Context, id string) error
}

type blacklistService struct{}

func NewBlacklistService() BlacklistService { return &blacklistService{} }

func (s *blacklistService) GetAll(ctx context.Context) ([]models.BlacklistEntry, error) {
	var results []models.BlacklistEntry
	cursor, err := database.MDB().Collection("blacklist").Find(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	if err = cursor.All(ctx, &results); err != nil {
		return nil, err
	}
	if results == nil {
		results = []models.BlacklistEntry{}
	}
	return results, nil
}

func (s *blacklistService) Create(ctx context.Context, b models.BlacklistEntry) (models.BlacklistEntry, error) {
	if b.ID == "" {
		b.ID = strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	_, err := database.MDB().Collection("blacklist").InsertOne(ctx, b)
	return b, err
}

func (s *blacklistService) Update(ctx context.Context, id string, b models.BlacklistEntry) (models.BlacklistEntry, error) {
	b.ID = id
	_, err := database.MDB().Collection("blacklist").ReplaceOne(ctx, bson.M{"id": id}, b)
	return b, err
}

func (s *blacklistService) Delete(ctx context.Context, id string) error {
	_, err := database.MDB().Collection("blacklist").DeleteOne(ctx, bson.M{"id": id})
	return err
}
