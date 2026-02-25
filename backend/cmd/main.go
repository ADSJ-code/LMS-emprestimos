package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/server"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/joho/godotenv"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := godotenv.Load(); err != nil {
		logger.Warn("arquivo .env não encontrado, usando variáveis de ambiente do sistema")
	}

	// Inicializar o Banco de Dados
	dsn := os.Getenv("MONGO_URI")
	if dsn == "" {
		dsn = "mongodb://127.0.0.1:27017/lms"
	}

	if err := database.InitDatabase(dsn); err != nil {
		logger.Error("Falha ao conectar o banco de dados", "error", err)
		os.Exit(1)
	}

	// Seed do admin
	authService := services.NewAuthService()
	if err := authService.SeedAdmin(context.Background()); err != nil {
		logger.Warn("Falha ao criar admin seed", "error", err)
	}

	// Instancia e roda o servidor
	srv := server.NewServer(logger)

	if err := srv.Run(); err != nil {
		logger.Error("Falha ao iniciar o servidor", "error", err)
		os.Exit(1)
	}
}
