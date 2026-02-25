package models

const UsersCollection = "users"

type Usuario struct {
	ID       any    `bson:"_id,omitempty" json:"id"`
	Nome     string `json:"nome"`
	Email    string `json:"email"`
	Senha    string `json:"senha"`
	Telefone string `json:"telefone"`
}
