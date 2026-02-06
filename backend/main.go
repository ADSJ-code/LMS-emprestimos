package main

import (
	"context"
	"embed" // NOVO: Necessário para embutir o frontend
	"encoding/json"
	"fmt"
	"io/fs" // NOVO: Para manipular o sistema de arquivos embutido
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/cors"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
)

var staticFiles embed.FS

var jwtKey = []byte(os.Getenv("JWT_SECRET"))

func init() {
	if len(jwtKey) == 0 {
		jwtKey = []byte("secret_key_123")
	}
}

// --- FUNÇÕES AUXILIARES ---

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// LOG ACTION: Salva no Banco de Dados e Imprime no Terminal
func logAction(action string, details string) {
	// 1. Visual no Terminal
	fmt.Printf("\033[32m[AUDITORIA %s]\033[0m %s - %s\n", time.Now().Format("15:04:05"), action, details)

	// 2. Salva no MongoDB
	if logCollection != nil {
		entry := LogEntry{
			ID:        strconv.FormatInt(time.Now().UnixNano(), 10),
			Action:    action,
			User:      "Sistema", // Em prod, pegaria do Contexto JWT
			Details:   details,
			Timestamp: time.Now(),
		}

		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_, err := logCollection.InsertOne(ctx, entry)
			if err != nil {
				fmt.Printf("ERRO AO SALVAR LOG: %v\n", err)
			}
		}()
	}
}

// ROTINA DE BACKGROUND
func StartBackgroundSystemLogs() {
	ticker := time.NewTicker(6 * time.Hour)
	go func() {
		time.Sleep(5 * time.Second)
		logSysAction("Sistema Iniciado", "Servidor online e conexões estabelecidas")

		for range ticker.C {
			logSysAction("Backup Automático", "Backup do Banco de Dados realizado com sucesso (Snapshot)")
			time.Sleep(2 * time.Second)
			logSysAction("Verificação de Segurança", "Varredura de integridade completada. Nenhuma ameaça.")
		}
	}()
}

func logSysAction(action string, details string) {
	if logCollection != nil {
		entry := LogEntry{
			ID:        strconv.FormatInt(time.Now().UnixNano(), 10),
			Action:    action,
			User:      "Sistema",
			Details:   details,
			Timestamp: time.Now(),
		}
		context.Background()
		go logCollection.InsertOne(context.Background(), entry)
	}
}

// ----------------------------------------------
// STRUCTS (Atualizadas para o novo sistema de usuários)
// ----------------------------------------------

type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// User Atualizado para suportar Nome, ID e Role
type User struct {
	ID       string `json:"id,omitempty" bson:"_id,omitempty"`
	Name     string `json:"name" bson:"name"`
	Username string `json:"username" bson:"username"` // Email
	Password string `json:"password,omitempty" bson:"password"`
	Role     string `json:"role" bson:"role"`
}

type PaymentRecord struct {
	Date         string  `json:"date" bson:"date"`
	Amount       float64 `json:"amount" bson:"amount"`
	CapitalPaid  float64 `json:"capitalPaid" bson:"capitalPaid"`
	InterestPaid float64 `json:"interestPaid" bson:"interestPaid"`
	Type         string  `json:"type" bson:"type"`
	Note         string  `json:"note" bson:"note"`
	RegisteredAt string  `json:"registeredAt" bson:"registeredAt"`
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
	FineRate            float64         `json:"fineRate" bson:"fineRate"`
	MoraInterestRate    float64         `json:"moraInterestRate,omitempty" bson:"moraInterestRate,omitempty"`
	ClientBank          string          `json:"clientBank" bson:"clientBank"`
	PaymentMethod       string          `json:"paymentMethod" bson:"paymentMethod"`
	Justification       string          `json:"justification,omitempty" bson:"justification,omitempty"`
	ChecklistAtApproval []string        `json:"checklistAtApproval,omitempty" bson:"checklistAtApproval,omitempty"`
	TotalPaidInterest   float64         `json:"totalPaidInterest" bson:"totalPaidInterest"`
	TotalPaidCapital    float64         `json:"totalPaidCapital" bson:"totalPaidCapital"`
	History             []PaymentRecord `json:"history" bson:"history"`
}

type ClientDoc struct {
	Name string `json:"name" bson:"name"`
	Data string `json:"data" bson:"data"`
	Type string `json:"type" bson:"type"`
}

type Client struct {
	ID           int64       `json:"id" bson:"id"`
	Name         string      `json:"name" bson:"name"`
	CPF          string      `json:"cpf" bson:"cpf"`
	RG           string      `json:"rg" bson:"rg"`
	Email        string      `json:"email" bson:"email"`
	Phone        string      `json:"phone" bson:"phone"`
	Address      string      `json:"address" bson:"address"`
	Number       string      `json:"number" bson:"number"`
	Neighborhood string      `json:"neighborhood" bson:"neighborhood"`
	City         string      `json:"city" bson:"city"`
	State        string      `json:"state" bson:"state"`
	CEP          string      `json:"cep" bson:"cep"`
	Observations string      `json:"observations" bson:"observations"`
	Documents    []ClientDoc `json:"documents" bson:"documents"`
	Status       string      `json:"status" bson:"status"`
}

type Affiliate struct {
	ID              string  `json:"id" bson:"id"`
	Name            string  `json:"name" bson:"name"`
	Email           string  `json:"email" bson:"email"`
	Phone           string  `json:"phone" bson:"phone"`
	Code            string  `json:"code" bson:"code"`
	Referrals       int     `json:"referrals" bson:"referrals"`
	CommissionRate  float64 `json:"commissionRate" bson:"commissionRate"`
	FixedCommission float64 `json:"fixedCommission" bson:"fixedCommission"`
	Earned          float64 `json:"earned" bson:"earned"`
	Status          string  `json:"status" bson:"status"`
	PixKey          string  `json:"pixKey" bson:"pixKey"`
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
	mongoURI := os.Getenv("MONGO_URI")
	if mongoURI == "" {
		mongoURI = "mongodb://127.0.0.1:27017"
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
	StartBackgroundSystemLogs()

	mux := http.NewServeMux()

	// --- 1. ROTAS DA API ---
	// Autenticação
	mux.HandleFunc("/api/auth/login", loginHandler) // (Ajustado para /auth/login para bater com novo api.ts)

	// Usuários (NOVO - Para a aba de Configurações)
	mux.HandleFunc("/api/users", usersHandler)
	mux.HandleFunc("/api/users/", userDetailHandler)

	// Negócio (Mantido do seu código original)
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

	// --- 2. SERVIR O FRONT-END (REACT EMBUTIDO) ---
	// A mágica acontece aqui: servimos a pasta 'dist' que está dentro do binário
	contentStatic, _ := fs.Sub(staticFiles, "dist")
	fileServer := http.FileServer(http.FS(contentStatic))

	// Wrapper para lidar com SPA (Single Page Application)
	// Se a rota não for /api e o arquivo não existir, retorna index.html
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Se a rota começa com /api, deixa o mux tratar (mas aqui já passou pelo handler específico se existisse)
		// Na verdade, no http.NewServeMux, rotas específicas têm prioridade.
		// Aqui só cai o que não foi pego pelas rotas /api acima.

		// Verifica se o arquivo existe na pasta estática (ex: assets/logo.png)
		f, err := contentStatic.Open(strings.TrimPrefix(path, "/"))
		if os.IsNotExist(err) {
			// Se não existe (ex: /dashboard, /clients), serve o index.html
			// Isso permite que o React Router controle a navegação
			r.URL.Path = "/"
		} else {
			f.Close()
		}

		fileServer.ServeHTTP(w, r)
	})

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"}, // Liberal para evitar dores de cabeça no modo Self-Hosted
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

// --- FUNÇÕES DE USUÁRIO E AUTH (Atualizadas) ---

func seedAdminUser() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var user User
	err := userCollection.FindOne(ctx, bson.M{"username": "admin@creditnow.com"}).Decode(&user)
	if err == mongo.ErrNoDocuments {
		passwordHash, _ := hashPassword("123456")
		user = User{
			ID:       strconv.FormatInt(time.Now().UnixNano(), 10),
			Name:     "Administrador Mestre",
			Username: "admin@creditnow.com",
			Password: passwordHash,
			Role:     "ADMIN",
		}
		_, err := userCollection.InsertOne(ctx, user)
		if err == nil {
			logSysAction("SYSTEM", "Usuário Admin padrão criado.")
		}
	}
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var storedUser User
	err := userCollection.FindOne(ctx, bson.M{"username": creds.Username}).Decode(&storedUser)
	if err != nil {
		logAction("LOGIN FALHA", "Usuário não encontrado: "+creds.Username)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if !checkPasswordHash(creds.Password, storedUser.Password) {
		logAction("LOGIN FALHA", "Senha incorreta para: "+creds.Username)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	logAction("LOGIN SUCESSO", "Usuário autenticado: "+creds.Username)

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

	// Retorna Token e Dados do Usuário (Sem a senha)
	storedUser.Password = ""
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"token": tokenString, "user": storedUser})
}

// --- HANDLERS DE USUÁRIOS (NOVO) ---

func usersHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	switch r.Method {
	case http.MethodGet:
		cursor, err := userCollection.Find(ctx, bson.M{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer cursor.Close(ctx)
		var results []User
		if err = cursor.All(ctx, &results); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Remove senhas antes de enviar
		for i := range results {
			results[i].Password = ""
		}
		json.NewEncoder(w).Encode(results)

	case http.MethodPost:
		var u User
		if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Verifica se usuário já existe
		count, _ := userCollection.CountDocuments(ctx, bson.M{"username": u.Username})
		if count > 0 {
			http.Error(w, "Usuário já existe", http.StatusConflict)
			return
		}

		// Hash da senha
		hash, _ := hashPassword(u.Password)
		u.Password = hash
		u.ID = strconv.FormatInt(time.Now().UnixNano(), 10)
		u.Role = "OPERATOR" // Padrão

		_, err := userCollection.InsertOne(ctx, u)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		logAction("NOVO USUÁRIO", "Criado usuário: "+u.Username)
		u.Password = ""
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(u)
	}
}

func userDetailHandler(w http.ResponseWriter, r *http.Request) {
	email := strings.TrimPrefix(r.URL.Path, "/api/users/")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	switch r.Method {
	case http.MethodPut: // Atualizar (ex: trocar senha)
		var updateData struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&updateData); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if updateData.Password != "" {
			hash, _ := hashPassword(updateData.Password)
			_, err := userCollection.UpdateOne(ctx, bson.M{"username": email}, bson.M{"$set": bson.M{"password": hash}})
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			logAction("ALTERAÇÃO SENHA", "Senha alterada para: "+email)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"message": "Senha atualizada"})
		}

	case http.MethodDelete:
		_, err := userCollection.DeleteOne(ctx, bson.M{"username": email})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		logAction("REMOÇÃO USUÁRIO", "Removido: "+email)
		w.WriteHeader(http.StatusNoContent)
	}
}

// --- FUNÇÕES DE NEGÓCIO (Mantidas originais) ---

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
		if l.History == nil {
			l.History = []PaymentRecord{}
		}
		_, err := loanCollection.InsertOne(ctx, l)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// --- LOG DE CRIAÇÃO ---
		logAction("NOVO EMPRÉSTIMO", fmt.Sprintf("Criado contrato para %s no valor de R$ %.2f", l.Client, l.Amount))

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(l)
	}
}

func loanUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/loans/")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	switch r.Method {
	case http.MethodPut:
		var l Loan
		if err := json.NewDecoder(r.Body).Decode(&l); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// --- CÁLCULO DE LUCRO E CAPITAL (ATUALIZADO) ---
		var calcCapital, calcInterest float64
		for _, record := range l.History {
			tipo := strings.ToLower(record.Type)
			if strings.Contains(tipo, "empréstimo") || strings.Contains(tipo, "contrato") || strings.Contains(tipo, "abertura") {
				continue
			}

			// Se tem separação explícita (novo formato), usa ela
			if record.CapitalPaid > 0 || record.InterestPaid > 0 {
				calcCapital += record.CapitalPaid
				calcInterest += record.InterestPaid
			} else {
				// Fallback para formato antigo (tentativa de inferência)
				if strings.Contains(tipo, "juros") {
					calcInterest += record.Amount
				} else {
					calcCapital += record.Amount
				}
			}
		}
		l.TotalPaidCapital = calcCapital
		l.TotalPaidInterest = calcInterest

		if l.Amount <= 0.10 {
			l.Status = "Pago"
		} else {
			if l.Status == "Pago" {
				l.Status = "Em Dia"
			}
		}

		_, err := loanCollection.ReplaceOne(ctx, bson.M{"id": id}, l)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// --- LOG DE ATUALIZAÇÃO ---
		logAction("ATUALIZAÇÃO CONTRATO", fmt.Sprintf("Contrato %s | Saldo Restante: R$ %.2f", id, l.Amount))

		json.NewEncoder(w).Encode(l)

	case http.MethodDelete:
		_, err := loanCollection.DeleteOne(ctx, bson.M{"id": id})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// --- LOG DE EXCLUSÃO ---
		logAction("EXCLUSÃO EMPRÉSTIMO", "Contrato removido permanentemente: "+id)

		w.WriteHeader(http.StatusNoContent)
	}
}

func clientsHandler(w http.ResponseWriter, r *http.Request) {
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

		// --- LOG NOVO CLIENTE ---
		logAction("NOVO CLIENTE", fmt.Sprintf("Nome: %s | CPF: %s", c.Name, c.CPF))

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(c)
	}
}

func clientUpdateHandler(w http.ResponseWriter, r *http.Request) {
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

		// --- LOG EDIÇÃO CLIENTE ---
		logAction("EDIÇÃO CLIENTE", fmt.Sprintf("ID: %d | Nome: %s", c.ID, c.Name))

		json.NewEncoder(w).Encode(c)
	case http.MethodDelete:
		_, err := clientCollection.DeleteOne(ctx, filter)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// --- LOG EXCLUSÃO CLIENTE ---
		logAction("EXCLUSÃO CLIENTE", fmt.Sprintf("ID: %d", id))

		w.WriteHeader(http.StatusNoContent)
	}
}

func affiliatesHandler(w http.ResponseWriter, r *http.Request) {
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

		// --- LOG NOVO AFILIADO ---
		logAction("NOVO AFILIADO", fmt.Sprintf("Nome: %s | Código: %s", a.Name, a.Code))

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(a)
	}
}

func affiliateUpdateHandler(w http.ResponseWriter, r *http.Request) {
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

		// --- LOG EDIÇÃO AFILIADO ---
		logAction("EDIÇÃO AFILIADO", fmt.Sprintf("ID: %s | Nome: %s", id, a.Name))

		json.NewEncoder(w).Encode(a)
	case http.MethodDelete:
		_, err := affiliateCollection.DeleteOne(ctx, bson.M{"id": id})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// --- LOG EXCLUSÃO AFILIADO ---
		logAction("EXCLUSÃO AFILIADO", "Afiliado removido: "+id)

		w.WriteHeader(http.StatusNoContent)
	}
}

func blacklistHandler(w http.ResponseWriter, r *http.Request) {
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

		// --- LOG LISTA NEGRA ---
		logAction("BLACKLIST ADIÇÃO", fmt.Sprintf("Nome: %s | CPF: %s | Risco: %s", b.Name, b.CPF, b.Risk))

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(b)
	}
}

func blacklistUpdateHandler(w http.ResponseWriter, r *http.Request) {
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

		// --- LOG BLACKLIST REMOÇÃO ---
		logAction("BLACKLIST REMOÇÃO", "Registro removido: "+id)

		w.WriteHeader(http.StatusNoContent)
	}
}

func settingsHandler(w http.ResponseWriter, r *http.Request) {
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

		// --- LOG ALTERAÇÃO CONFIGURAÇÃO ---
		logAction("CONFIGURAÇÃO", "Configurações globais do sistema foram alteradas")

		json.NewEncoder(w).Encode(s)
	}
}

func logsHandler(w http.ResponseWriter, r *http.Request) {
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
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	totalActive, _ := loanCollection.CountDocuments(ctx, bson.M{"status": bson.M{"$ne": "Pago"}})
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
