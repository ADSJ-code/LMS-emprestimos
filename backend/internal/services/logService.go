package services

import (
	"context"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
)

type LogService interface {
	GetAll(ctx context.Context) ([]models.LogEntry, error)
	Create(ctx context.Context, entry models.LogEntry) error
}

type logService struct{}

func NewLogService() LogService { return &logService{} }

func (s *logService) GetAll(ctx context.Context) ([]models.LogEntry, error) {
	var results []models.LogEntry
	cursor, err := database.MDB().Collection("logs").Find(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	if err = cursor.All(ctx, &results); err != nil {
		return nil, err
	}
	if results == nil {
		results = []models.LogEntry{}
	}
	return results, nil
}

func (s *logService) Create(ctx context.Context, entry models.LogEntry) error {
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now()
	}
	_, err := database.MDB().Collection("logs").InsertOne(ctx, entry)
	return err
}
