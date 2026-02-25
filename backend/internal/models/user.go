package models

const UsersCollection = "users"

type User struct {
	ID       any    `bson:"_id,omitempty" json:"id"`
	Nome     string `json:"nome"`
	Username string `json:"username" bson:"username"`
	Password string `json:"password" bson:"password"`
	Telefone string `json:"telefone"`
}
