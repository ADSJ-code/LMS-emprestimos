package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"
)

type WhatsappService interface {
	SendMessage(ctx context.Context, userConectado string, phone string, message string, delay int, name string, lateDays int, updatedAmount float64) error
}

type whatsappService struct {
	ApiURL   string
	ApiToken string
}

func NewWhatsappService() WhatsappService {
	return &whatsappService{
		ApiURL: "http://34.69.98.196:8080/",
		ApiToken: "5E603D2122C0-42C5-AFAD-FE1E8C0A3791",
	}
}

// Estruturas para mapear o seu JSON
type Options struct {
	Delay    int    `json:"delay"`
	Presence string `json:"presence"`
}

type TextMessage struct {
	Text string `json:"text"`
}

type MessagePayload struct {
	Number      string      `json:"number"`
	Options     Options     `json:"options"`
	TextMessage TextMessage `json:"textMessage"`
}



func (s *whatsappService) SendMessage(ctx context.Context, userConectado string, phone string, message string, delayLevel int, name string, lateDays int, updatedAmount float64) error {
	endPoint := "message/sendText"
	if userConectado == "" {
		userConectado = "teste"
	}
	message = DefinirMensagemComDetalhes(delayLevel, name, lateDays, updatedAmount)

	// Tirar caracteres não numéricos do telefone
	re := regexp.MustCompile(`\D`)
    phoneLimpo := re.ReplaceAllString(phone, "")

	phone = phoneLimpo
	if len(phone) < 13 && len(phone) >= 10 {
		phone = "55" + phone
	}


	
	url := s.ApiURL + endPoint + "/" + userConectado

	// Corpo da requisição
	payload := MessagePayload{
		Number: phone,
		Options: Options{
			Delay:    1200,
			Presence: "composing",
		},
		TextMessage: TextMessage{
			Text: message,
		},
	}

	// Converter para JSON
	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("falha ao criar payload: %v", err)
	}


	// Envia para a API externa
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("falha ao criar requisição: %v", err)
	}

	// Adiciona os Headers do seu curl
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", "96CF28F9329F-44A3-80DB-5190D7B27185")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36")

	
	// Configura o client com timeout
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Lê a resposta
	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("Status: %s\nResposta: %s\n", resp.Status, string(body))

	return err
}

func DefinirMensagemComDetalhes(delayLevel int, name string, lateDays int, updatedAmount float64) string {
	delayLevel = 1
	
	// Formatação simples para moeda (R$)
	valorFormatado := fmt.Sprintf("R$ %.2f", updatedAmount)
	
	switch delayLevel {
	case 1:
		// Lembrete Amigável (Atraso Curto: 1-5 dias)
		return fmt.Sprintf(
			"Olá, *%s*! \n\nNotamos que o seu pagamento da Credit Now ainda não consta em nosso sistema.\n\n" +
			"📌 *Detalhes:*\n• Valor: %s\n• Atraso: %d dia(s)\n\n" +
			"Sabemos que imprevistos acontecem! Podemos te ajudar a regularizar isso hoje com uma condição especial? 💸", 
			name, valorFormatado, lateDays)

	case 2:
		// Alerta de Pendência (Atraso Médio: 6-15 dias)
		return fmt.Sprintf(
			"Atenção, *%s*! ⚠️\n\nIdentificamos que a sua pendência de %s completou %d dias.\n\n" +
			"A regularização imediata evita a suspensão de benefícios e a incidência de novos juros. " +
			"Podemos gerar um novo boleto ou PIX para você agora?", 
			name, valorFormatado, lateDays)

	case 3:
		// Notificação Urgente/Pré-Jurídico (Atraso Longo: +15 dias)
		return fmt.Sprintf(
			"🚨 *NOTIFICAÇÃO URGENTE* - %s\n\n*%s*, tentamos diversos contatos sem sucesso.\n\n" +
			"O débito de %s está em fase avançada de atraso (%d dias). Para evitar o envio do seu CPF aos órgãos de proteção ao crédito (SPC/Serasa), responda esta mensagem imediatamente para negociar. 🚫", 
			name, name, valorFormatado, lateDays)

	default:
		return "Olá! Identificamos uma pendência em seu cadastro na Credit Now. Por favor, entre em contato com nosso suporte para verificarmos as opções de pagamento disponíveis."
	}
		

}
