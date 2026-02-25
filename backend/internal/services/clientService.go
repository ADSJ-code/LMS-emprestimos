package services

import (
	"context"
	"strconv"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"go.mongodb.org/mongo-driver/v2/bson"
)

type ClientService interface {
	GetAll(ctx context.Context) ([]models.Client, error)
	Create(ctx context.Context, c models.Client) (models.Client, error)
	Update(ctx context.Context, identifier string, c models.Client) (models.Client, error)
	Delete(ctx context.Context, identifier string) error
}

type clientService struct{}

func NewClientService() ClientService { return &clientService{} }

func (s *clientService) GetAll(ctx context.Context) ([]models.Client, error) {
	var results []models.Client
	cursor, err := database.MDB().Collection(models.CustomerCollection).Find(ctx, bson.M{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	if err = cursor.All(ctx, &results); err != nil {
		return nil, err
	}
	if results == nil {
		results = []models.Client{}
	}
	return results, nil
}

func (s *clientService) Create(ctx context.Context, c models.Client) (models.Client, error) {
	if c.ID == 0 {
		c.ID = time.Now().UnixMilli()
	}
	_, err := database.MDB().Collection(models.CustomerCollection).InsertOne(ctx, c)
	return c, err
}

func (s *clientService) Update(ctx context.Context, identifier string, c models.Client) (models.Client, error) {
	filter := s.buildFilter(identifier)
	_, err := database.MDB().Collection(models.CustomerCollection).ReplaceOne(ctx, filter, c)
	return c, err
}

func (s *clientService) Delete(ctx context.Context, identifier string) error {
	filter := s.buildFilter(identifier)
	_, err := database.MDB().Collection(models.CustomerCollection).DeleteOne(ctx, filter)
	return err
}

func (s *clientService) buildFilter(identifier string) bson.M {
	id, err := strconv.ParseInt(identifier, 10, 64)
	if err != nil {
		return bson.M{"cpf": identifier}
	}
	return bson.M{"id": id}
}
