package routes

import (
	"log/slog"
	"net/http"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/controllers"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/services"
	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

func SetupRoutes(router *gin.Engine, logger *slog.Logger) {
	// Serviços
	loanService := services.NewLoanService()
	clientService := services.NewClientService()
	affiliateService := services.NewAffiliateService()
	blacklistService := services.NewBlacklistService()
	settingService := services.NewSettingsService()
	logService := services.NewLogService()
	dashboardService := services.NewDashboardService()
	authService := services.NewAuthService()
	usuarioService := services.NewUsuarioService()
	msgService := services.NewWhatsappService()

	// Controladores
	loanController := controllers.NewLoanController(loanService, logger)
	clientController := controllers.NewClientController(clientService, logger)
	affiliateController := controllers.NewAffiliateController(affiliateService, logger)
	blacklistController := controllers.NewBlacklistController(blacklistService, logger)
	settingController := controllers.NewSettingController(settingService, logger)
	logController := controllers.NewLogController(logService, logger)
	dashboardController := controllers.NewDashboardController(dashboardService, logger)
	authController := controllers.NewAuthController(authService, logger)
	usuarioController := controllers.NewUsuarioController(usuarioService, logger)
	msgController := controllers.NewWhatsappController(msgService)

	// --- Rotas públicas ---
	api := router.Group("/api")
	{
		api.POST("/auth/login", authController.Login)
	}

	// --- Rotas protegidas ---
	protected := router.Group("/api")
	//protected.Use(middleware.AuthRequired())
	{
		// Usuários
		protected.GET("/users", usuarioController.GetUsuarios)
		protected.GET("/users/:id", usuarioController.GetUsuarioByID)
		protected.POST("/users", usuarioController.CreateUsuario)
		protected.PUT("/users/:id", usuarioController.UpdateUsuario)
		protected.DELETE("/users/:id", usuarioController.DeleteUsuario)

		// Empréstimos (Loans)
		protected.GET("/loans", loanController.GetLoans)
		protected.POST("/loans", loanController.CreateLoan)
		protected.PUT("/loans/:id", loanController.UpdateLoan)
		protected.DELETE("/loans/:id", loanController.DeleteLoan)

		// Clientes (Customers)
		protected.GET("/customers", clientController.GetClients)
		protected.POST("/customers", clientController.CreateClient)
		protected.PUT("/customers/:id", clientController.UpdateClient)
		protected.DELETE("/customers/:id", clientController.DeleteClient)

		// Afiliados
		protected.GET("/affiliates", affiliateController.GetAffiliates)
		protected.POST("/affiliates", affiliateController.CreateAffiliate)
		protected.PUT("/affiliates/:id", affiliateController.UpdateAffiliate)
		protected.DELETE("/affiliates/:id", affiliateController.DeleteAffiliate)

		// Blacklist
		protected.GET("/blacklist", blacklistController.GetBlacklist)
		protected.POST("/blacklist", blacklistController.CreateEntry)
		protected.PUT("/blacklist/:id", blacklistController.UpdateEntry)
		protected.DELETE("/blacklist/:id", blacklistController.DeleteEntry)

		// Configurações e Dashboard
		protected.GET("/settings", settingController.GetSettings)
		protected.POST("/settings", settingController.SaveSettings)
		protected.PUT("/settings", settingController.SaveSettings)
		protected.GET("/logs", logController.GetLogs)
		protected.GET("/dashboard/summary", dashboardController.GetSummary)

		// Mensagens WhatsApp
		protected.POST("/message", msgController.EnviarMensagem)

	} // Rotas da documentação
	api.GET("/doc", func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, "/api/doc/index.html")
	})
	api.GET("/doc/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
}
