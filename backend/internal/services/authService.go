package services

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
)

var jwtSecret []byte

func init() {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "secret_key_123"
	}
	jwtSecret = []byte(secret)
}

type AuthService interface {
	Login(ctx context.Context, username, password string) (string, error)
	SeedAdmin(ctx context.Context) error
}

type authService struct{}

func NewAuthService() AuthService { return &authService{} }

func (s *authService) Login(ctx context.Context, username, password string) (string, error) {
	var user models.User
	err := database.MDB().Collection("users").FindOne(ctx, bson.M{
		"username": username,
		"password": password,
	}).Decode(&user)

	if err != nil {
		return "", errors.New("credenciais inválidas")
	}

	expirationTime := time.Now().Add(24 * time.Hour)
	claims := &models.Claims{
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func (s *authService) SeedAdmin(ctx context.Context) error {
	var user models.User
	err := database.MDB().Collection("users").FindOne(ctx, bson.M{"username": "admin"}).Decode(&user)

	if err == mongo.ErrNoDocuments {
		user = models.User{Username: "admin", Password: "123456"}
		_, err := database.MDB().Collection("users").InsertOne(ctx, user)
		return err
	}
	return nil
}
