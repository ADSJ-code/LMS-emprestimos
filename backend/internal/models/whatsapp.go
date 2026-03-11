package models

type ProfileStatus struct {
	Status string `json:"status"`
	SetAt  string `json:"setAt"`
}

type Integration struct {
	Integration       string `json:"integration"`
	Token             string `json:"token"`
	WebhookWaBusiness string `json:"webhook_wa_business"`
}

type InstanceData struct {
	InstanceName      string        `json:"instanceName"`
	InstanceID        string        `json:"instanceId"`
	Owner             string        `json:"owner"`
	ProfileName       string        `json:"profileName"`
	ProfilePictureUrl string        `json:"profilePictureUrl"`
	ProfileStatus     ProfileStatus `json:"profileStatus"`
	Status            string        `json:"status"`
	ServerUrl         string        `json:"serverUrl"`
	ApiKey            string        `json:"apikey"`
	Integration       Integration   `json:"integration"`
}

type InstanceResponse struct {
	Instance InstanceData `json:"instance"`
}

type CreateInstancePayload struct {
	Name   string `json:"instanceName"`
	Token  string `json:"token,omitempty"` // Opcional
	QRCode bool   `json:"qrcode"`
	Phone  string `json:"phone"`
}

type CreateInstance struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}