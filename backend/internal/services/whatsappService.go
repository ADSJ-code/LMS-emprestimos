package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/internal/models"
)

type WhatsappService interface {
	SendMessage(ctx context.Context, userConectado string, phone string, message string, delay int, name string, lateDays int, updatedAmount float64, dateVencimento string) error
	ViewInstances(ctx context.Context) ([]models.InstanceResponse, error)
	CreateInstance(ctx context.Context, name string, phone string) (interface{}, error)
	ConnectInstance(ctx context.Context, instanceName, number string) (interface{}, error)
}

type whatsappService struct {
	ApiURL   string
	ApiToken string
	ApiKey   string
	ApiGlobalKey string
}

func NewWhatsappService() WhatsappService {
	return &whatsappService{
		ApiURL: "http://34.69.98.196:8080",
		ApiToken: "5E603D2122C0-42C5-AFAD-FE1E8C0A3791",
		ApiKey: "96CF28F9329F-44A3-80DB-5190D7B27185",
		ApiGlobalKey: "VIDSFZs6I3FlZtnsbUoK",
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


func (s *whatsappService) SendMessage(ctx context.Context, userConectado string, phone string, message string, delayLevel int, name string, lateDays int, updatedAmount float64, dateVencimento string) error {
	endPoint := "/message/sendText"
	if userConectado == "" {
		userConectado = "teste"
	}
	message = DefinirMensagemComDetalhes(delayLevel, name, lateDays, updatedAmount, dateVencimento)

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
	req.Header.Set("apikey", s.ApiKey)
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

func DefinirMensagemComDetalhes(delayLevel int, name string, lateDays int, updatedAmount float64, dateVencimento string) string {
	
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
			"Olá, *%s*! Tudo bem? ⚠️\n\n"+
			"Passando para lembrar do vencimento da sua parcela no valor de  *%s* no dia %s Qualquer dúvida, estamos à disposição!\n\n",
			name, valorFormatado, dateVencimento)

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

func (s *whatsappService) ViewInstances(ctx context.Context) ([]models.InstanceResponse, error) {
	url := s.ApiURL + "/instance/fetchInstances"

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("falha ao criar requisição: %v", err)
	}

	// Configuração vital dos Headers
	req.Header.Set("apikey", s.ApiGlobalKey)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("falha ao enviar requisição: %v", err)
	}
	defer resp.Body.Close()

	// Decodificando a resposta (que é um Array/Slice [])
	var instances []models.InstanceResponse
    if err := json.NewDecoder(resp.Body).Decode(&instances); err != nil {
        return nil, err
    }

	return instances, err
}

func (s *whatsappService) CreateInstance(ctx context.Context, name string, phone string) (interface{}, error) {
	url := s.ApiURL + "/instance/create"

	log.Printf("Criando instância com nome: %s e telefone: %s", name, phone)
	// Prepara os dados para a criação
	payload := models.CreateInstancePayload{
		Name: name,
		QRCode:       true,   // Ativamos para receber o Base64 do QR Code se necessário
		Phone:       phone,
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return nil, err
	}

	// Headers essenciais
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", s.ApiGlobalKey)

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return result, nil
}

func (s *whatsappService) ConnectInstance(ctx context.Context, instanceName, number string) (interface{}, error) {
	url := fmt.Sprintf("%s/instance/connect/%s?number=%s", s.ApiURL, instanceName, number)

	log.Printf("\n\n\nConectando instância '%s' com número '%s'", instanceName, number)
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, err
    }

    req.Header.Set("apikey", s.ApiGlobalKey) 
    req.Header.Set("Accept", "application/json")

    client := &http.Client{Timeout: 30 * time.Second} // Timeout maior para o QR Code
    resp, err := client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result interface{}
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, err
    }

    return result, nil
}

//	curl --location 'http://localhost:8080/message/sendText/teste' \
//	--header 'Accept: application/json, text/plain, */*' \
//	--header 'Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7' \
//	--header 'Cache-Control: no-cache' \
//	--header 'Connection: keep-alive' \
//	--header 'Content-Type: application/json' \
//	--header 'Origin: http://localhost:8080' \
//	--header 'Pragma: no-cache' \
//	--header 'Referer: http://localhost:8080/manager/teste' \
//	--header 'Sec-Fetch-Dest: empty' \
//	--header 'Sec-Fetch-Mode: cors' \
//	--header 'Sec-Fetch-Site: same-origin' \
//	--header 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36' \
//	--header 'apikey: 96CF28F9329F-44A3-80DB-5190D7B27185' \
//	--header 'sec-ch-ua: "Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"' \
//	--header 'sec-ch-ua-mobile: ?0' \
//	--header 'sec-ch-ua-platform: "Linux"' \
//	--header 'Cookie: g_state={"i_l":0,"i_ll":1764275182449}' \
//	--data '{
//	    "number": "5511990277630",
//	    "options": {
//	        "delay": 1000,
//	        "presence": "composing"
//	    },
//	    "textMessage": {
//	        "text": "Hellow k7t"
//	    }
//	}'


// S C:\Users\Rara jogo\Desktop\Trabalho\Emprestimos\Nova pasta\ProjetoEmprestimo-back> 
// curl.exe --location "http://34.69.98.196:8080/instance/fetchInstances" 
// --header "apikey: VIDSFZs6I3FlZtnsbUoK"


// [{"instance":{
// "instanceName":"teste",
// "instanceId":"99bace57-99f2-4205-aba3-ab03a547ff80",
// "owner":"5511990277630@s.whatsapp.net",
// "profileName":"Raiany",
// "profilePictureUrl":"https://pps.whatsapp.net/v/t61.24694-24/518562817_1810536239675389_5763342067236340886_n.jpg?ccb=11-4&oh=01_Q5Aa4AHt8z6TDgL0hmKDc0gneM2t7XWMXGUS1lVssfAZP-1Tmw&oe=69BE77BC&_nc_sid=5e03e0&_nc_cat=107",
// "profileStatus":{"status":"-_-",
// "setAt":"2026-02-20T05:42:19.000Z"},
// "status":"open",
// "serverUrl":"http://localhost:8080",
// "apikey":"96CF28F9329F-44A3-80DB-5190D7B27185",
// "integration":{"integration":"WHATSAPP-BAILEYS",
// "token":"96CF28F9329F-44A3-80DB-5190D7B27185",
// "webhook_wa_business":"http://localhost:8080/webhook/whatsapp/teste"}}}]