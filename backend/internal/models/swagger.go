package models

// Tipos auxiliares para documentacao Swagger

// LoginRequest representa o body do login
type LoginRequest struct {
	Username string `json:"username" example:"admin"`
	Password string `json:"password" example:"123456"`
}

// LoginResponse representa a resposta do login
type LoginResponse struct {
	Token string `json:"token" example:"eyJhbGciOiJIUzI1NiIs..."`
}

// MessageRequest representa o body para envio de mensagem WhatsApp
type MessageRequest struct {
	UserConectado string `json:"user_conectado" example:"teste"`
	Phone         string `json:"phone" example:"5511999999999"`
	Message       string `json:"message" example:"Olá!"`
	Delay         int    `json:"delay" example:"1"`
}

// ErrorResponse representa uma resposta de erro padrao
type ErrorResponse struct {
	Error string `json:"error" example:"mensagem de erro"`
}

// SuccessMessage representa uma resposta de sucesso com mensagem
type SuccessMessage struct {
	Message string `json:"message" example:"operacao realizada com sucesso"`
}

// StatusResponse representa uma resposta de status
type StatusResponse struct {
	Status string `json:"status" example:"Mensagem enviada com sucesso"`
}

// UsuariosResponse representa a resposta da listagem de usuarios
type UsuariosResponse struct {
	Usuarios []User `json:"usuarios"`
}

// DashboardSummary representa o resumo do dashboard
type DashboardSummary struct {
	TotalActive   int64   `json:"totalActive" example:"15"`
	TotalOverdue  int64   `json:"totalOverdue" example:"3"`
	TotalCapital  float64 `json:"totalCapital" example:"50000.00"`
	ActiveClients int64   `json:"activeClients" example:"20"`
}
