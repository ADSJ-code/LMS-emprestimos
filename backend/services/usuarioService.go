package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

type UsuarioService interface {
	GetUsuarios() ([]models.User, error)
	GetUsuarioByID(id uint) (models.User, error)
	CreateUsuario(usuario models.User) error
	UpdateUsuario(usuario models.User) error
	DeleteUsuario(id uint) error
}

type usuarioService struct {
	// Pode adicionar dependências aqui se preferir não usar globais
}

func NewUsuarioService() UsuarioService {
	return &usuarioService{}
}

// Helper para contexto do MongoDB
func getCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 5*time.Second)
}

func (s *usuarioService) GetUsuarios() ([]models.User, error) {
	var usuarios []models.User

	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()

		cursor, err := database.MDB().Collection("user").Find(ctx, bson.M{})
		if err != nil {
			return nil, fmt.Errorf("erro ao buscar no mongo: %v", err)
		}
		// Sempre feche o cursor para evitar vazamento de memória
		defer cursor.Close(ctx)

		if err = cursor.All(ctx, &usuarios); err != nil {
			return nil, fmt.Errorf("erro ao decodificar usuarios: %v", err)
		}

		// Se retornar vazio mas err for nil, o banco está vazio
		return usuarios, nil
	}

	// Lógica Postgres (GORM)
	err := database.DB().Find(&usuarios).Error
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar no postgres: %v", err)
	}
	return usuarios, nil
}

func (s *usuarioService) GetUsuarioByID(id uint) (models.User, error) {
	var usuario models.User

	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()

		err := database.MDB().Collection("user").FindOne(ctx, bson.M{"id": id}).Decode(&usuario)
		if err == mongo.ErrNoDocuments {
			return usuario, errors.New("usuário não encontrado")
		}
		return usuario, err
	}

	err := database.DB().First(&usuario, id).Error
	return usuario, err
}

func (s *usuarioService) CreateUsuario(usuario models.User) error {
	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()
		_, err := database.MDB().Collection("user").InsertOne(ctx, usuario)
		return err
	}

	return database.DB().Create(&usuario).Error
}

func (s *usuarioService) UpdateUsuario(usuario models.User) error {
	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()
		filter := bson.M{"id": usuario.ID}
		update := bson.M{"$set": usuario}
		_, err := database.MDB().Collection("user").UpdateOne(ctx, filter, update)
		return err
	}

	return database.DB().Save(&usuario).Error
}

func (s *usuarioService) DeleteUsuario(id uint) error {
	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()
		_, err := database.MDB().Collection("user").DeleteOne(ctx, bson.M{"id": id})
		return err
	}

	return database.DB().Delete(&models.User{}, id).Error
}

func SaveTest() error {
	// 3. Exemplo de dado para salvar
	user := map[string]string{"name": "Fulaninho", "email": "fulano@cloud.com"}

	// 4. Salva (se for Mongo, vai pra collection; se Postgres, pra tabela)
	err := SaveData(user, "users")
	if err != nil {
		log.Println("Erro ao salvar:", err)
	}

	return err
}

func SaveData(data interface{}, collectionName string) error {
	if database.UseMongo() {
		// Lógica para MongoDB
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_, err := database.MDB().Collection(collectionName).InsertOne(ctx, data)
		return err
	}

	// Lógica para Postgres (GORM)
	// No GORM, o 'data' deve ser uma struct que mapeia para uma tabela
	return database.DB().Create(data).Error
}
