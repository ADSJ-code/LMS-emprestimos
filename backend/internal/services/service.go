package services

type WelcomeService interface {
	GetWelcomeMessage() string
}

type welcomeServiceImpl struct{}

func NewWelcomeService() WelcomeService {
	return &welcomeServiceImpl{}
}

func (s *welcomeServiceImpl) GetWelcomeMessage() string {
	return "Bem-vindo ao Projeto Emprestimo!"
}
