package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type WhatsappService interface {
	SendMessage(ctx context.Context, userConectado string, phone string, message string, delay int) error
}

type whatsappService struct {
	ApiURL   string
	ApiToken string
}

func NewWhatsappService() WhatsappService {
	return &whatsappService{
		ApiURL:   "http://34.69.98.196:8080/",
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

func (s *whatsappService) SendMessage(ctx context.Context, userConectado string, phone string, message string, delay int) error {
	endPoint := "message/sendText"
	if userConectado == "" {
		userConectado = "teste"
	}
	message = DefinirMensagem(delay)

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

func DefinirMensagem(delayLevel int) string {
	message := ""

	switch delayLevel {
	case 1:
		message = "Olá! Sua parcela venceu há 1 dia. Evite juros, pague hoje! 💸"
	case 2:
		message = "Atenção: Atraso identificado. Regularize seu débito para evitar bloqueios. ⚠️"
	case 3:
		message = "URGENTE: Entre em contato para negociar agora! 🚫"
	default:
		message = "Olá! Identificamos uma pendência. Entre em contato conosco."
	}

	return message
}
