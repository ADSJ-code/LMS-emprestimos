package main

import (
	"context"
	"encoding/json"
	"fmt" // Importado para logs coloridos/formatados
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/controllers"
	"github.com/Rara05/ProjetoEmprestimo-back/backend/services"
	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/cors"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var jwtKey = []byte(os.Getenv("JWT_SECRET"))

func init() {
	if len(jwtKey) == 0 {
		jwtKey = []byte("secret_key_123")
	}
}

type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

type User struct {
	Username string `json:"username" bson:"username"`
	Password string `json:"password" bson:"password"`
}

// --- ESTRUTURAS ---

type PaymentRecord struct {
	Date   string  `json:"date" bson:"date"`
	Amount float64 `json:"amount" bson:"amount"`
	Type   string  `json:"type" bson:"type"`
	Note   string  `json:"note" bson:"note"`
}

type Loan struct {
	ID                  string   `json:"id" bson:"id"`
	Client              string   `json:"client" bson:"client"`
	Amount              float64  `json:"amount" bson:"amount"`
	Installments        int      `json:"installments" bson:"installments"`
	InterestRate        float64  `json:"interestRate" bson:"interestRate"`
	StartDate           string   `json:"startDate" bson:"startDate"`
	NextDue             string   `json:"nextDue" bson:"nextDue"`
	Status              string   `json:"status" bson:"status"`
	InstallmentValue    float64  `json:"installmentValue" bson:"installmentValue"`
	FineRate            float64  `json:"fineRate,omitempty" bson:"fineRate,omitempty"`
	MoraInterestRate    float64  `json:"moraInterestRate,omitempty" bson:"moraInterestRate,omitempty"`
	Justification       string   `json:"justification,omitempty" bson:"justification,omitempty"`
	ChecklistAtApproval []string `json:"checklistAtApproval,omitempty" bson:"checklistAtApproval,omitempty"`
	TotalPaidInterest   float64  `json:"totalPaidInterest,omitempty" bson:"totalPaidInterest,omitempty"`
	TotalPaidCapital    float64  `json:"totalPaidCapital,omitempty" bson:"totalPaidCapital,omitempty"`

	// Removido 'omitempty' para forçar a gravação e leitura deste campo
	History []PaymentRecord `json:"history" bson:"history"`
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

var (
	mongoClient         *mongo.Client
	loanCollection      *mongo.Collection
	clientCollection    *mongo.Collection
	userCollection      *mongo.Collection
	affiliateCollection *mongo.Collection
	logCollection       *mongo.Collection
	blacklistCollection *mongo.Collection
	settingsCollection  *mongo.Collection
)

func main() {

	msgService := services.NewWhatsappService()
	msgController := controllers.NewWhatsappController(msgService)

	mongoURI := os.Getenv("MONGO_URI")
	if mongoURI == "" {
		mongoURI = "mongodb://root:c83ZoQR7onqzVZl-CwB_-Pw2FH4ZXHpiv2ebYH2nAC87gAOW@be2f531d-55bf-427a-ba07-502009ee1f10.southamerica-east1.firestore.goog:443/creditnow?loadBalanced=true&tls=true&authMechanism=SCRAM-SHA-256&retryWrites=false"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var err error
	mongoClient, err = mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		log.Fatal("Failed to connect to MongoDB:", err)
	}

	err = mongoClient.Ping(ctx, nil)
	if err != nil {
		log.Fatal("Could not ping MongoDB:", err)
	}

	db := mongoClient.Database("lms")
	loanCollection = db.Collection("loans")
	clientCollection = db.Collection("clients")
	userCollection = db.Collection("users")
	affiliateCollection = db.Collection("affiliates")
	logCollection = db.Collection("logs")
	blacklistCollection = db.Collection("blacklist")
	settingsCollection = db.Collection("settings")
	log.Println("Connected to MongoDB!")

	seedAdminUser()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/login", loginHandler)
	mux.HandleFunc("/api/loans", loansHandler)
	mux.HandleFunc("/api/loans/", loanUpdateHandler)
	mux.HandleFunc("/api/clients", clientsHandler)
	mux.HandleFunc("/api/clients/", clientUpdateHandler)
	mux.HandleFunc("/api/affiliates", affiliatesHandler)
	mux.HandleFunc("/api/affiliates/", affiliateUpdateHandler)
	mux.HandleFunc("/api/blacklist", blacklistHandler)
	mux.HandleFunc("/api/blacklist/", blacklistUpdateHandler)
	mux.HandleFunc("/api/logs", logsHandler)
	mux.HandleFunc("/api/settings", settingsHandler)
	mux.HandleFunc("/api/dashboard/summary", dashboardSummaryHandler)

	mux.HandleFunc("POST /message", msgController.EnviarMensagem)

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
	}).Handler(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Println("Server starting on :" + port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func seedAdminUser() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var user User
	err := userCollection.FindOne(ctx, bson.M{"username": "admin"}).Decode(&user)
	if err == mongo.ErrNoDocuments {
		user = User{Username: "admin", Password: "123456"}
		_, err := userCollection.InsertOne(ctx, user)
		if err != nil {
			log.Println("Failed to seed admin user:", err)
		} else {
			log.Println("Admin user seeded!")
		}
	}
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var creds User
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var user User
	err := userCollection.FindOne(ctx, bson.M{"username": creds.Username, "password": creds.Password}).Decode(&user)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	expirationTime := time.Now().Add(24 * time.Hour)
	claims := &Claims{
		Username: creds.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtKey)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": tokenString})
}

func loansHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	switch r.Method {
	case http.MethodGet:
		cursor, err := loanCollection.Find(ctx, bson.M{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer cursor.Close(ctx)
		var results []Loan
		if err = cursor.All(ctx, &results); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if results == nil {
			results = []Loan{}
		}
		json.NewEncoder(w).Encode(results)
	case http.MethodPost:
		var l Loan
		if err := json.NewDecoder(r.Body).Decode(&l); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Inicializa array vazio se vier nulo, para garantir gravação
		if l.History == nil {
			l.History = []PaymentRecord{}
		}

		_, err := loanCollection.InsertOne(ctx, l)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(l)
	}
}

// ATUALIZAÇÃO IMPORTANTE COM LOGS DE DIAGNÓSTICO
func loanUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/loans/")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	switch r.Method {
	case http.MethodPut:
		var l Loan
		// Decodifica o JSON que chega do React
		if err := json.NewDecoder(r.Body).Decode(&l); err != nil {
			log.Printf("ERRO AO DECODIFICAR JSON: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// --- ÁREA DE DIAGNÓSTICO ---
		// Olhe no terminal do backend para ver esta mensagem
		fmt.Println("---------------------------------------------------")
		fmt.Printf("RECEBIDO PUT PARA ID: %s\n", id)
		fmt.Printf("CLIENTE: %s\n", l.Client)
		fmt.Printf("ITENS NO HISTÓRICO: %d\n", len(l.History))
		for i, h := range l.History {
			fmt.Printf("  [%d] Data: %s | Valor: %.2f | Tipo: %s\n", i, h.Date, h.Amount, h.Type)
		}
		fmt.Println("---------------------------------------------------")
		// -----------------------------

		// Substitui o documento no banco
		_, err := loanCollection.ReplaceOne(ctx, bson.M{"id": id}, l)
		if err != nil {
			log.Printf("ERRO AO SALVAR NO MONGO: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(l)

	case http.MethodDelete:
		_, err := loanCollection.DeleteOne(ctx, bson.M{"id": id})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ... Resto dos handlers (Client, Affiliate, etc) permanecem iguais ...
// (Copie os handlers clientsHandler, clientUpdateHandler, etc do seu código original
// ou do anterior, pois eles não precisam de alteração)

func clientsHandler(w http.ResponseWriter, r *http.Request) {
	// ... (código existente) ...
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, err := clientCollection.Find(ctx, bson.M{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var results []Client
		cursor.All(ctx, &results)
		if results == nil {
			results = []Client{}
		}
		json.NewEncoder(w).Encode(results)
	case http.MethodPost:
		var c Client
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if c.ID == 0 {
			c.ID = time.Now().UnixNano() / 1e6
		}
		_, err := clientCollection.InsertOne(ctx, c)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(c)
	}
}

func clientUpdateHandler(w http.ResponseWriter, r *http.Request) {
	// ... (código existente) ...
	idStr := strings.TrimPrefix(r.URL.Path, "/api/clients/")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	id, err := strconv.ParseInt(idStr, 10, 64)
	filter := bson.M{"id": id}
	if err != nil {
		filter = bson.M{"cpf": idStr}
	}
	switch r.Method {
	case http.MethodPut:
		var c Client
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		_, err := clientCollection.ReplaceOne(ctx, filter, c)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(c)
	case http.MethodDelete:
		_, err := clientCollection.DeleteOne(ctx, filter)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func affiliatesHandler(w http.ResponseWriter, r *http.Request) {
	// ... (código existente) ...
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, err := affiliateCollection.Find(ctx, bson.M{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var results []Affiliate
		cursor.All(ctx, &results)
		if results == nil {
			results = []Affiliate{}
		}
		json.NewEncoder(w).Encode(results)
	case http.MethodPost:
		var a Affiliate
		if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if a.ID == "" {
			a.ID = strconv.FormatInt(time.Now().UnixNano(), 10)
		}
		_, err := affiliateCollection.InsertOne(ctx, a)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(a)
	}
}

func affiliateUpdateHandler(w http.ResponseWriter, r *http.Request) {
	// ... (código existente) ...
	id := strings.TrimPrefix(r.URL.Path, "/api/affiliates/")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var a Affiliate
		if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		_, err := affiliateCollection.ReplaceOne(ctx, bson.M{"id": id}, a)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(a)
	case http.MethodDelete:
		_, err := affiliateCollection.DeleteOne(ctx, bson.M{"id": id})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func blacklistHandler(w http.ResponseWriter, r *http.Request) {
	// ... (código existente) ...
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, err := blacklistCollection.Find(ctx, bson.M{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var results []BlacklistEntry
		cursor.All(ctx, &results)
		if results == nil {
			results = []BlacklistEntry{}
		}
		json.NewEncoder(w).Encode(results)
	case http.MethodPost:
		var b BlacklistEntry
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if b.ID == "" {
			b.ID = strconv.FormatInt(time.Now().UnixNano(), 10)
		}
		_, err := blacklistCollection.InsertOne(ctx, b)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(b)
	}
}

func blacklistUpdateHandler(w http.ResponseWriter, r *http.Request) {
	// ... (código existente) ...
	id := strings.TrimPrefix(r.URL.Path, "/api/blacklist/")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var b BlacklistEntry
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		_, err := blacklistCollection.ReplaceOne(ctx, bson.M{"id": id}, b)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(b)
	case http.MethodDelete:
		_, err := blacklistCollection.DeleteOne(ctx, bson.M{"id": id})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func settingsHandler(w http.ResponseWriter, r *http.Request) {
	// ... (código existente) ...
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		var s interface{}
		err := settingsCollection.FindOne(ctx, bson.M{}).Decode(&s)
		if err != nil {
			if err == mongo.ErrNoDocuments {
				json.NewEncoder(w).Encode(map[string]interface{}{})
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(s)
	case http.MethodPost, http.MethodPut:
		var s interface{}
		if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		opts := options.Replace().SetUpsert(true)
		_, err := settingsCollection.ReplaceOne(ctx, bson.M{}, s, opts)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(s)
	}
}

func logsHandler(w http.ResponseWriter, r *http.Request) {
	// ... (código existente) ...
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if r.Method == http.MethodGet {
		cursor, err := logCollection.Find(ctx, bson.M{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		var results []LogEntry
		cursor.All(ctx, &results)
		if results == nil {
			results = []LogEntry{}
		}
		json.NewEncoder(w).Encode(results)
	}
}

func dashboardSummaryHandler(w http.ResponseWriter, r *http.Request) {
	// ... (código existente) ...
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	totalActive, _ := loanCollection.CountDocuments(ctx, bson.M{"status": "Em Dia"})
	totalOverdue, _ := loanCollection.CountDocuments(ctx, bson.M{"status": "Atrasado"})
	activeClients, _ := clientCollection.CountDocuments(ctx, bson.M{"status": "Ativo"})
	pipeline := []bson.M{
		{"$match": bson.M{"status": bson.M{"$ne": "Pago"}}},
		{"$group": bson.M{
			"_id": nil,
			"totalCapital": bson.M{"$sum": bson.M{"$subtract": []interface{}{
				bson.M{"$ifNull": []interface{}{"$amount", 0}},
				bson.M{"$ifNull": []interface{}{"$totalPaidCapital", 0}},
			}}},
		}},
	}
	cursor, _ := loanCollection.Aggregate(ctx, pipeline)
	var results []bson.M
	cursor.All(ctx, &results)
	var totalCapital float64
	if len(results) > 0 {
		if val, ok := results[0]["totalCapital"].(float64); ok {
			totalCapital = val
		}
	}
	summary := map[string]interface{}{
		"totalActive":   totalActive,
		"totalOverdue":  totalOverdue,
		"totalCapital":  totalCapital,
		"activeClients": activeClients,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}
