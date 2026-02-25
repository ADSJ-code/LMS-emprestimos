package server

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/middleware"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/routes"
	"github.com/gin-gonic/gin"
)

type Server struct {
	logger *slog.Logger
	router *gin.Engine
}

func NewServer(logger *slog.Logger) *Server {
	gin.SetMode(gin.ReleaseMode)
	return &Server{
		logger: logger,
		router: gin.New(),
	}
}

func (s *Server) Run() error {
	s.setupRouter()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	s.logger.Info("Iniciando Servidor", "port", port)
	return http.ListenAndServe(":"+port, s.router)
}

func (s *Server) setupRouter() {
	s.router.Use(gin.Recovery())
	s.router.Use(middleware.CORSMiddleware())
	s.router.Use(slogMiddleware(s.logger))
	routes.SetupRoutes(s.router, s.logger)
}

func slogMiddleware(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		latency := time.Since(start)

		logger.Info("request processed",
			slog.String("method", c.Request.Method),
			slog.String("path", c.Request.URL.Path),
			slog.Int("status", c.Writer.Status()),
			slog.Duration("latency", latency),
			slog.String("client_ip", c.ClientIP()),
		)
	}
}
