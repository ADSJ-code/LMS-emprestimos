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

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("falha ao criar payload: %v", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("falha ao criar requisição: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", "96CF28F9329F-44A3-80DB-5190D7B27185")
	req.Header.Set("Accept", "application/json, text/plain, */*")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("Status: %s\nResposta: %s\n", resp.Status, string(body))

	return nil
}

func DefinirMensagem(delayLevel int) string {
	switch delayLevel {
	case 1:
		return "Olá! Sua parcela venceu há 1 dia. Evite juros, pague hoje!"
	case 2:
		return "Atenção: Atraso identificado. Regularize seu débito para evitar bloqueios."
	case 3:
		return "URGENTE: Entre em contato para negociar agora!"
	default:
		return "Olá! Identificamos uma pendência. Entre em contato conosco."
	}
}
