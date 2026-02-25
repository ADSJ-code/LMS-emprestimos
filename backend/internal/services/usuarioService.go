package services

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

type UsuarioService interface {
	GetUsuarios() ([]models.Usuario, error)
	GetUsuarioByID(id uint) (models.Usuario, error)
	CreateUsuario(usuario models.Usuario) error
	UpdateUsuario(usuario models.Usuario) error
	DeleteUsuario(id uint) error
}

type usuarioService struct{}

func NewUsuarioService() UsuarioService {
	return &usuarioService{}
}

func getCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 5*time.Second)
}

func (s *usuarioService) GetUsuarios() ([]models.Usuario, error) {
	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()

		cursor, err := database.MDB().Collection(models.UsersCollection).Find(ctx, bson.M{})
		if err != nil {
			return nil, err
		}
		defer cursor.Close(ctx)

		var usuarios []models.Usuario
		if err = cursor.All(ctx, &usuarios); err != nil {
			return nil, err
		}
		return usuarios, nil
	}

	var usuarios []models.Usuario
	err := database.DB().Find(&usuarios).Error
	return usuarios, err
}

func (s *usuarioService) GetUsuarioByID(id uint) (models.Usuario, error) {
	var usuario models.Usuario

	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()

		err := database.MDB().Collection(models.UsersCollection).FindOne(ctx, bson.M{"id": id}).Decode(&usuario)
		if err == mongo.ErrNoDocuments {
			return usuario, errors.New("usuário não encontrado")
		}
		return usuario, err
	}

	err := database.DB().First(&usuario, id).Error
	return usuario, err
}

func (s *usuarioService) CreateUsuario(usuario models.Usuario) error {
	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()
		_, err := database.MDB().Collection(models.UsersCollection).InsertOne(ctx, usuario)
		return err
	}

	return database.DB().Create(&usuario).Error
}

func (s *usuarioService) UpdateUsuario(usuario models.Usuario) error {
	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()
		filter := bson.M{"id": usuario.ID}
		update := bson.M{"$set": usuario}
		_, err := database.MDB().Collection(models.UsersCollection).UpdateOne(ctx, filter, update)
		return err
	}

	return database.DB().Save(&usuario).Error
}

func (s *usuarioService) DeleteUsuario(id uint) error {
	if database.UseMongo() {
		ctx, cancel := getCtx()
		defer cancel()
		_, err := database.MDB().Collection(models.UsersCollection).DeleteOne(ctx, bson.M{"id": id})
		return err
	}

	return database.DB().Delete(&models.Usuario{}, id).Error
}

func SaveTest() error {
	user := map[string]string{"name": "Fulaninho", "email": "fulano@cloud.com"}
	err := SaveData(user, "users")
	if err != nil {
		log.Println("Erro ao salvar:", err)
	}
	return err
}

func SaveData(data interface{}, collectionName string) error {
	if database.UseMongo() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := database.MDB().Collection(collectionName).InsertOne(ctx, data)
		return err
	}

	return database.DB().Create(data).Error
}
