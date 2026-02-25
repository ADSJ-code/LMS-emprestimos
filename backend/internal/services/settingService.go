package services

import (
	"context"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type SettingsService interface {
	Get(ctx context.Context) (interface{}, error)
	Update(ctx context.Context, s interface{}) (interface{}, error)
}

type settingsService struct{}

func NewSettingsService() SettingsService { return &settingsService{} }

func (s *settingsService) Get(ctx context.Context) (interface{}, error) {
	var results interface{}
	err := database.MDB().Collection("settings").FindOne(ctx, bson.M{}).Decode(&results)

	if err != nil {
		if err == mongo.ErrNoDocuments {
			return map[string]interface{}{}, nil
		}
		return nil, err
	}
	return results, nil
}

func (s *settingsService) Update(ctx context.Context, data interface{}) (interface{}, error) {
	opts := options.Replace().SetUpsert(true)
	_, err := database.MDB().Collection("settings").ReplaceOne(ctx, bson.M{}, data, opts)
	if err != nil {
		return nil, err
	}
	return data, nil
}
