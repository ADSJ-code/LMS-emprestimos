package models

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

type User struct {
	Username string `json:"username" bson:"username"`
	Password string `json:"password" bson:"password"`
}

type PaymentRecord struct {
	Date   string  `json:"date" bson:"date"`
	Amount float64 `json:"amount" bson:"amount"`
	Type   string  `json:"type" bson:"type"`
	Note   string  `json:"note" bson:"note"`
}

type Loan struct {
	ID                  string          `json:"id" bson:"id"`
	Client              string          `json:"client" bson:"client"`
	Amount              float64         `json:"amount" bson:"amount"`
	Installments        int             `json:"installments" bson:"installments"`
	InterestRate        float64         `json:"interestRate" bson:"interestRate"`
	StartDate           string          `json:"startDate" bson:"startDate"`
	NextDue             string          `json:"nextDue" bson:"nextDue"`
	Status              string          `json:"status" bson:"status"`
	InstallmentValue    float64         `json:"installmentValue" bson:"installmentValue"`
	FineRate            float64         `json:"fineRate,omitempty" bson:"fineRate,omitempty"`
	MoraInterestRate    float64         `json:"moraInterestRate,omitempty" bson:"moraInterestRate,omitempty"`
	Justification       string          `json:"justification,omitempty" bson:"justification,omitempty"`
	ChecklistAtApproval []string        `json:"checklistAtApproval,omitempty" bson:"checklistAtApproval,omitempty"`
	TotalPaidInterest   float64         `json:"totalPaidInterest,omitempty" bson:"totalPaidInterest,omitempty"`
	TotalPaidCapital    float64         `json:"totalPaidCapital,omitempty" bson:"totalPaidCapital,omitempty"`
	History             []PaymentRecord `json:"history" bson:"history"`
}

type Client struct {
	ID     int64  `json:"id" bson:"id"`
	Name   string `json:"name" bson:"name"`
	CPF    string `json:"cpf" bson:"cpf"`
	Email  string `json:"email" bson:"email"`
	Phone  string `json:"phone" bson:"phone"`
	Status string `json:"status" bson:"status"`
	City   string `json:"city" bson:"city"`
}

type Affiliate struct {
	ID             string  `json:"id" bson:"id"`
	Name           string  `json:"name" bson:"name"`
	Email          string  `json:"email" bson:"email"`
	Phone          string  `json:"phone" bson:"phone"`
	Code           string  `json:"code" bson:"code"`
	Referrals      int     `json:"referrals" bson:"referrals"`
	CommissionRate float64 `json:"commissionRate" bson:"commissionRate"`
	Earned         float64 `json:"earned" bson:"earned"`
	Status         string  `json:"status" bson:"status"`
	PixKey         string  `json:"pixKey" bson:"pixKey"`
}

type LogEntry struct {
	ID        string    `json:"id" bson:"id"`
	Action    string    `json:"action" bson:"action"`
	User      string    `json:"user" bson:"user"`
	Details   string    `json:"details" bson:"details"`
	Timestamp time.Time `json:"timestamp" bson:"timestamp"`
}

type BlacklistEntry struct {
	ID     string `json:"id" bson:"id"`
	Name   string `json:"name" bson:"name"`
	CPF    string `json:"cpf" bson:"cpf"`
	Reason string `json:"reason" bson:"reason"`
	Date   string `json:"date" bson:"date"`
	Risk   string `json:"riskLevel" bson:"riskLevel"`
	Notes  string `json:"notes" bson:"notes"`
}
