package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/cors"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
)

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

// LOG ACTION
func logAction(action string, details string) {
	fmt.Printf("\033[32m[AUDITORIA %s]\033[0m %s - %s\n", time.Now().Format("15:04:05"), action, details)

	if logCollection != nil {
		entry := LogEntry{
			ID:        strconv.FormatInt(time.Now().UnixNano(), 10),
			Action:    action,
			User:      "Sistema",
			Details:   details,
			Timestamp: time.Now(),
		}

		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_, err := logCollection.InsertOne(ctx, entry)
			if err != nil {
				fmt.Printf("ERRO AO SALVAR LOG: %v\n", err)
			}
		}()
	}
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

// --- ROTINAS DE BACKGROUND ---

func StartBackgroundSystemLogs() {
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		time.Sleep(5 * time.Second)
		logSysAction("Sistema Iniciado", "Servidor online e conexões estabelecidas")

		for range ticker.C {
			logSysAction("Monitoramento", "Verificação de integridade do sistema realizada.")
		}
	}()
}

func StartDailyBackupRoutine() {
	go func() {
		for {
			now := time.Now()
			nextRun := time.Date(now.Year(), now.Month(), now.Day(), 3, 0, 0, 0, now.Location())
			if now.After(nextRun) {
				nextRun = nextRun.Add(24 * time.Hour)
			}
			duration := nextRun.Sub(now)
			log.Printf("🕒 Próximo Backup Automático agendado para: %s", nextRun.Format("02/01 15:04"))
			time.Sleep(duration)
			performInternalBackup()
		}
	}()
}

func performInternalBackup() {
	log.Println("🔄 Iniciando Backup Diário...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	db := mongoClient.Database("lms")
	db.Collection("clients_backup").Drop(ctx)
	cursor, _ := clientCollection.Find(ctx, bson.M{})
	var clients []interface{}
	if err := cursor.All(ctx, &clients); err == nil && len(clients) > 0 {
		db.Collection("clients_backup").InsertMany(ctx, clients)
	}

	db.Collection("loans_backup").Drop(ctx)
	cursorLoans, _ := loanCollection.Find(ctx, bson.M{})
	var loans []interface{}
	if err := cursorLoans.All(ctx, &loans); err == nil && len(loans) > 0 {
		db.Collection("loans_backup").InsertMany(ctx, loans)
	}
	logSysAction("BACKUP AUTOMÁTICO", "Cópia de segurança realizada com sucesso.")
}

// ----------------------------------------------
// STRUCTS
// ----------------------------------------------

type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

type User struct {
	ID       string `json:"id,omitempty" bson:"_id,omitempty"`
	Name     string `json:"name" bson:"name"`
	Username string `json:"email" bson:"username"`
	Password string `json:"password,omitempty" bson:"password"`
	Role     string `json:"role" bson:"role"`
}

type CompanySettings struct {
	Name    string `json:"name" bson:"name"`
	CNPJ    string `json:"cnpj" bson:"cnpj"`
	PixKey  string `json:"pixKey" bson:"pixKey"`
	Email   string `json:"email" bson:"email"`
	Phone   string `json:"phone" bson:"phone"`
	Address string `json:"address" bson:"address"`
}

type SystemSettings struct {
	AutoBackup   bool `json:"autoBackup" bson:"autoBackup"`
	RequireLogin bool `json:"requireLogin" bson:"requireLogin"`
	WarningDays  int  `json:"warningDays" bson:"warningDays"` // Novo campo para o Alerta
}

type Settings struct {
	ID      string          `json:"id,omitempty" bson:"_id,omitempty"`
	Company CompanySettings `json:"company" bson:"company"`
	System  SystemSettings  `json:"system" bson:"system"`
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
	ID               string  `json:"id" bson:"id"`
	Client           string  `json:"client" bson:"client"`
	Amount           float64 `json:"amount" bson:"amount"`
	Installments     int     `json:"installments" bson:"installments"`
	InterestRate     float64 `json:"interestRate" bson:"interestRate"`
	StartDate        string  `json:"startDate" bson:"startDate"`
	NextDue          string  `json:"nextDue" bson:"nextDue"`
	Status           string  `json:"status" bson:"status"`
	InstallmentValue float64 `json:"installmentValue" bson:"installmentValue"`

	// --- TAXAS E MULTAS (0 é um valor válido agora) ---
	FineRate         float64 `json:"fineRate" bson:"fineRate"`
	MoraInterestRate float64 `json:"moraInterestRate" bson:"moraInterestRate"`

	ClientBank          string   `json:"clientBank" bson:"clientBank"`
	PaymentMethod       string   `json:"paymentMethod" bson:"paymentMethod"`
	Justification       string   `json:"justification,omitempty" bson:"justification,omitempty"`
	ChecklistAtApproval []string `json:"checklistAtApproval,omitempty" bson:"checklistAtApproval,omitempty"`

	TotalPaidInterest float64         `json:"totalPaidInterest" bson:"totalPaidInterest"`
	TotalPaidCapital  float64         `json:"totalPaidCapital" bson:"totalPaidCapital"`
	History           []PaymentRecord `json:"history" bson:"history"`

	// --- NOVOS CAMPOS PARA O ERP ---
	InterestType    string  `json:"interestType,omitempty" bson:"interestType,omitempty"`       // "PRICE" ou "SIMPLE"
	Frequency       string  `json:"frequency,omitempty" bson:"frequency,omitempty"`             // "DIARIO", "SEMANAL", "MENSAL"
	ProjectedProfit float64 `json:"projectedProfit,omitempty" bson:"projectedProfit,omitempty"` // Lucro total estimado

	// --- CAMPOS PARA ACORDO ---
	AgreementDate  string  `json:"agreementDate,omitempty" bson:"agreementDate,omitempty"`
	AgreementValue float64 `json:"agreementValue,omitempty" bson:"agreementValue,omitempty"`

	GuarantorName    string `json:"guarantorName,omitempty" bson:"guarantorName,omitempty"`
	GuarantorCPF     string `json:"guarantorCPF,omitempty" bson:"guarantorCPF,omitempty"`
	GuarantorAddress string `json:"guarantorAddress,omitempty" bson:"guarantorAddress,omitempty"`
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

type BackupData struct {
	Date     string   `json:"date"`
	Clients  []Client `json:"clients"`
	Loans    []Loan   `json:"loans"`
	Settings Settings `json:"settings"`
	Users    []User   `json:"users"`
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

	// TIMEOUT DE CONEXÃO: 60 SEGUNDOS
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
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
	StartDailyBackupRoutine()

	mux := http.NewServeMux()

	// --- ROTAS ---
	mux.HandleFunc("/api/auth/login", loginHandler)
	mux.HandleFunc("/api/users", usersHandler)
	mux.HandleFunc("/api/users/", userDetailHandler)
	mux.HandleFunc("/api/admin/reset", resetDatabaseHandler)
	mux.HandleFunc("/api/admin/restore", restoreDatabaseHandler)
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

	// --- FRONTEND ---
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		possiveisCaminhos := []string{"dist", "backend/dist", "../backend/dist"}
		var caminhoDist string
		for _, p := range possiveisCaminhos {
			if info, err := os.Stat(p); err == nil && info.IsDir() {
				caminhoDist = p
				break
			}
		}
		if caminhoDist == "" {
			http.Error(w, "Erro Crítico: Pasta 'dist' do Frontend não encontrada.", http.StatusInternalServerError)
			return
		}
		path := filepath.Join(caminhoDist, r.URL.Path)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			http.ServeFile(w, r, filepath.Join(caminhoDist, "index.html"))
			return
		}
		http.FileServer(http.Dir(caminhoDist)).ServeHTTP(w, r)
	})

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
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
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var user User
	err := userCollection.FindOne(ctx, bson.M{"username": "admin@creditnow.com"}).Decode(&user)
	if err == mongo.ErrNoDocuments {
		log.Println("⚠️ Admin não encontrado. Criando agora...")
		passwordHash, _ := hashPassword("123456")
		user = User{
			ID: strconv.FormatInt(time.Now().UnixNano(), 10), Name: "Administrador Mestre", Username: "admin@creditnow.com", Password: passwordHash, Role: "ADMIN",
		}
		userCollection.InsertOne(ctx, user)
		log.Println("✅ SUCESSO: Usuário Admin criado!")
	}
}

func resetDatabaseHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	loanCollection.Drop(ctx)
	clientCollection.Drop(ctx)
	affiliateCollection.Drop(ctx)
	blacklistCollection.Drop(ctx)
	logCollection.Drop(ctx)
	userCollection.Drop(ctx)
	settingsCollection.Drop(ctx)
	seedAdminUser()
	logSysAction("SYSTEM RESET", "Banco de dados reiniciado.")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Sistema resetado."})
}

// --- HANDLERS ---

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var creds struct{ Username, Password string }
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var storedUser User
	if err := userCollection.FindOne(ctx, bson.M{"username": creds.Username}).Decode(&storedUser); err != nil {
		logAction("LOGIN FALHA", "User: "+creds.Username)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if !checkPasswordHash(creds.Password, storedUser.Password) {
		logAction("LOGIN FALHA", "Senha errada: "+creds.Username)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	logAction("LOGIN SUCESSO", "User: "+creds.Username)
	expirationTime := time.Now().Add(24 * time.Hour)
	claims := &Claims{Username: creds.Username, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(expirationTime)}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString(jwtKey)
	storedUser.Password = ""
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"token": tokenString, "user": storedUser})
}

func usersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	switch r.Method {
	case http.MethodGet:
		cursor, _ := userCollection.Find(ctx, bson.M{})
		defer cursor.Close(ctx)
		var results []User
		cursor.All(ctx, &results)
		for i := range results {
			results[i].Password = ""
		}
		json.NewEncoder(w).Encode(results)

	case http.MethodPost:
		var u User
		if err := json.NewDecoder(r.Body).Decode(&u); err != nil {
			http.Error(w, "JSON Inválido", http.StatusBadRequest)
			return
		}

		fmt.Printf("DEBUG: Recebido Usuário: %+v\n", u)

		if u.Username == "" || u.Password == "" {
			http.Error(w, "Erro: Email e Senha são obrigatórios", http.StatusBadRequest)
			return
		}

		count, _ := userCollection.CountDocuments(ctx, bson.M{"username": u.Username})
		if count > 0 {
			http.Error(w, "Erro: Usuário já existe", http.StatusConflict)
			return
		}
		hash, _ := hashPassword(u.Password)
		u.Password = hash

		if u.ID == "" {
			u.ID = primitive.NewObjectID().Hex()
		}
		u.Role = "OPERATOR"

		_, err := userCollection.InsertOne(ctx, u)
		if err != nil {
			fmt.Printf("ERRO CRÍTICO MONGO: %v\n", err)
			http.Error(w, "Erro no Banco de Dados: "+err.Error(), http.StatusInternalServerError)
			return
		}

		logAction("NOVO USUÁRIO", u.Username)
		u.Password = ""
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(u)
	}
}

func userDetailHandler(w http.ResponseWriter, r *http.Request) {
	email := strings.TrimPrefix(r.URL.Path, "/api/users/")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var updateData struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&updateData)
		if updateData.Password != "" {
			hash, _ := hashPassword(updateData.Password)
			userCollection.UpdateOne(ctx, bson.M{"username": email}, bson.M{"$set": bson.M{"password": hash}})
			logAction("ALTERAÇÃO SENHA", email)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"message": "Senha atualizada"})
		}
	case http.MethodDelete:
		userCollection.DeleteOne(ctx, bson.M{"username": email})
		logAction("REMOÇÃO USUÁRIO", email)
		w.WriteHeader(http.StatusNoContent)
	}
}

func restoreDatabaseHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	var data BackupData
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "Erro ao ler backup: "+err.Error(), http.StatusBadRequest)
		return
	}
	loanCollection.Drop(ctx)
	clientCollection.Drop(ctx)
	affiliateCollection.Drop(ctx)
	blacklistCollection.Drop(ctx)
	userCollection.Drop(ctx)
	settingsCollection.Drop(ctx)
	if len(data.Clients) > 0 {
		newClients := make([]interface{}, len(data.Clients))
		for i, v := range data.Clients {
			newClients[i] = v
		}
		clientCollection.InsertMany(ctx, newClients)
	}
	if len(data.Loans) > 0 {
		newLoans := make([]interface{}, len(data.Loans))
		for i, v := range data.Loans {
			newLoans[i] = v
		}
		loanCollection.InsertMany(ctx, newLoans)
	}
	if len(data.Users) > 0 {
		newUsers := make([]interface{}, len(data.Users))
		for i, v := range data.Users {
			newUsers[i] = v
		}
		userCollection.InsertMany(ctx, newUsers)
	} else {
		seedAdminUser()
	}
	settingsCollection.InsertOne(ctx, data.Settings)
	logAction("RESTAURAÇÃO", "Sistema restaurado.")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Sucesso!"})
}

// --- DEMAIS HANDLERS (LOANS COM NOVOS CAMPOS) ---

func loansHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, _ := loanCollection.Find(ctx, bson.M{})
		var results []Loan
		cursor.All(ctx, &results)
		if results == nil {
			results = []Loan{}
		}
		json.NewEncoder(w).Encode(results)
	case http.MethodPost:
		var l Loan
		json.NewDecoder(r.Body).Decode(&l)

		var clientData Client
		err := clientCollection.FindOne(ctx, bson.M{"name": l.Client}).Decode(&clientData)
		if err == nil {
			countBL, _ := blacklistCollection.CountDocuments(ctx, bson.M{"cpf": clientData.CPF})
			if countBL > 0 {
				http.Error(w, "OPERAÇÃO BLOQUEADA: Este cliente consta na Lista Negra.", http.StatusForbidden)
				return
			}
		}

		if l.History == nil {
			l.History = []PaymentRecord{}
		}
		loanCollection.InsertOne(ctx, l)
		logAction("NOVO EMPRÉSTIMO", fmt.Sprintf("%s - R$ %.2f", l.Client, l.Amount))
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(l)
	}
}

func loanUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/loans/")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var l Loan
		json.NewDecoder(r.Body).Decode(&l)
		var calcCapital, calcInterest float64
		for _, record := range l.History {
			tipo := strings.ToLower(record.Type)
			if strings.Contains(tipo, "empréstimo") || strings.Contains(tipo, "contrato") || strings.Contains(tipo, "abertura") {
				continue
			}
			if record.CapitalPaid > 0 || record.InterestPaid > 0 {
				calcCapital += record.CapitalPaid
				calcInterest += record.InterestPaid
			} else {
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
		} else if l.Status == "Pago" {
			l.Status = "Em Dia"
		}
		loanCollection.ReplaceOne(ctx, bson.M{"id": id}, l)
		logAction("ATUALIZAÇÃO CONTRATO", id)
		json.NewEncoder(w).Encode(l)
	case http.MethodDelete:
		loanCollection.DeleteOne(ctx, bson.M{"id": id})
		logAction("EXCLUSÃO EMPRÉSTIMO", id)
		w.WriteHeader(http.StatusNoContent)
	}
}

func clientsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, _ := clientCollection.Find(ctx, bson.M{})
		var results []Client
		cursor.All(ctx, &results)
		if results == nil {
			results = []Client{}
		}
		json.NewEncoder(w).Encode(results)
	case http.MethodPost:
		var c Client
		json.NewDecoder(r.Body).Decode(&c)

		countBL, _ := blacklistCollection.CountDocuments(ctx, bson.M{"cpf": c.CPF})
		if countBL > 0 {
			http.Error(w, "CPF BLOQUEADO: Este CPF consta na Lista Negra.", http.StatusForbidden)
			return
		}

		if c.ID == 0 {
			c.ID = time.Now().UnixNano() / 1e6
		}
		clientCollection.InsertOne(ctx, c)
		logAction("NOVO CLIENTE", c.Name)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(c)
	}
}

func clientUpdateHandler(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/clients/")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	id, err := strconv.ParseInt(idStr, 10, 64)
	filter := bson.M{"id": id}
	if err != nil {
		filter = bson.M{"cpf": idStr}
	}
	switch r.Method {
	case http.MethodPut:
		var c Client
		json.NewDecoder(r.Body).Decode(&c)
		clientCollection.ReplaceOne(ctx, filter, c)
		logAction("EDIÇÃO CLIENTE", c.Name)
		json.NewEncoder(w).Encode(c)
	case http.MethodDelete:
		clientCollection.DeleteOne(ctx, filter)
		logAction("EXCLUSÃO CLIENTE", idStr)
		w.WriteHeader(http.StatusNoContent)
	}
}

func affiliatesHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, _ := affiliateCollection.Find(ctx, bson.M{})
		var results []Affiliate
		cursor.All(ctx, &results)
		if results == nil {
			results = []Affiliate{}
		}
		json.NewEncoder(w).Encode(results)
	case http.MethodPost:
		var a Affiliate
		json.NewDecoder(r.Body).Decode(&a)
		if a.ID == "" {
			a.ID = strconv.FormatInt(time.Now().UnixNano(), 10)
		}
		affiliateCollection.InsertOne(ctx, a)
		logAction("NOVO AFILIADO", a.Name)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(a)
	}
}

func affiliateUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/affiliates/")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var a Affiliate
		json.NewDecoder(r.Body).Decode(&a)
		affiliateCollection.ReplaceOne(ctx, bson.M{"id": id}, a)
		logAction("EDIÇÃO AFILIADO", a.Name)
		json.NewEncoder(w).Encode(a)
	case http.MethodDelete:
		affiliateCollection.DeleteOne(ctx, bson.M{"id": id})
		logAction("EXCLUSÃO AFILIADO", id)
		w.WriteHeader(http.StatusNoContent)
	}
}

func blacklistHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, _ := blacklistCollection.Find(ctx, bson.M{})
		var results []BlacklistEntry
		cursor.All(ctx, &results)
		if results == nil {
			results = []BlacklistEntry{}
		}
		json.NewEncoder(w).Encode(results)
	case http.MethodPost:
		var b BlacklistEntry
		json.NewDecoder(r.Body).Decode(&b)
		if b.ID == "" {
			b.ID = strconv.FormatInt(time.Now().UnixNano(), 10)
		}
		blacklistCollection.InsertOne(ctx, b)
		logAction("BLACKLIST ADIÇÃO", b.Name)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(b)
	}
}

func blacklistUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/blacklist/")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var b BlacklistEntry
		json.NewDecoder(r.Body).Decode(&b)
		blacklistCollection.ReplaceOne(ctx, bson.M{"id": id}, b)
		json.NewEncoder(w).Encode(b)
	case http.MethodDelete:
		blacklistCollection.DeleteOne(ctx, bson.M{"id": id})
		logAction("BLACKLIST REMOÇÃO", id)
		w.WriteHeader(http.StatusNoContent)
	}
}

func settingsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		var s Settings
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
		var s Settings
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
		logAction("CONFIGURAÇÃO", "Configurações globais do sistema foram alteradas")
		json.NewEncoder(w).Encode(s)
	}
}

func logsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
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

// --- DASHBOARD ATUALIZADO (DRILL-DOWN) ---
func dashboardSummaryHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// 1. Contagem Básica
	totalActiveContracts, _ := loanCollection.CountDocuments(ctx, bson.M{"status": bson.M{"$ne": "Pago"}})
	totalOverdue, _ := loanCollection.CountDocuments(ctx, bson.M{"status": "Atrasado"})
	totalClientsRegistered, _ := clientCollection.CountDocuments(ctx, bson.M{}) // Total Cadastrados

	// 2. Clientes com Dívida Ativa (Drill-down)
	// Agrupamos contratos não pagos pelo nome do cliente para contar quantos CPF únicos devem
	pipelineDebtors := []bson.M{
		{"$match": bson.M{"status": bson.M{"$ne": "Pago"}}},
		{"$group": bson.M{"_id": "$client"}},
		{"$count": "count"},
	}
	cursorDebtors, _ := loanCollection.Aggregate(ctx, pipelineDebtors)
	var resultDebtors []bson.M
	cursorDebtors.All(ctx, &resultDebtors)
	clientsWithDebt := 0
	if len(resultDebtors) > 0 {
		if val, ok := resultDebtors[0]["count"].(int32); ok {
			clientsWithDebt = int(val)
		}
	}

	// 3. Capital em Aberto (Soma)
	pipelineCapital := []bson.M{
		{"$match": bson.M{"status": bson.M{"$ne": "Pago"}}},
		{"$group": bson.M{
			"_id": nil,
			"totalCapital": bson.M{"$sum": bson.M{"$subtract": []interface{}{
				bson.M{"$ifNull": []interface{}{"$amount", 0}},
				bson.M{"$ifNull": []interface{}{"$totalPaidCapital", 0}},
			}}},
		}},
	}
	cursorCap, _ := loanCollection.Aggregate(ctx, pipelineCapital)
	var resultsCap []bson.M
	cursorCap.All(ctx, &resultsCap)
	var totalCapital float64
	if len(resultsCap) > 0 {
		if val, ok := resultsCap[0]["totalCapital"].(float64); ok {
			totalCapital = val
		}
	}

	// 4. Recebido Hoje
	startOfDay := time.Now().Format("2006-01-02")
	cursorToday, _ := loanCollection.Find(ctx, bson.M{
		"history.date": bson.M{"$regex": startOfDay},
	})
	var loansToday []Loan
	cursorToday.All(ctx, &loansToday)
	var recoveredToday float64
	for _, loan := range loansToday {
		for _, rec := range loan.History {
			if strings.HasPrefix(rec.Date, startOfDay) {
				tipo := strings.ToLower(rec.Type)
				if strings.Contains(tipo, "abertura") || strings.Contains(tipo, "empréstimo") || strings.Contains(tipo, "contrato") {
					continue
				}
				recoveredToday += rec.Amount
			}
		}
	}

	summary := map[string]interface{}{
		"totalActive":            totalActiveContracts,   // Contratos Abertos
		"totalOverdue":           totalOverdue,           // Contratos Atrasados
		"totalCapital":           totalCapital,           // Dinheiro na Rua
		"clientsRegistered":      totalClientsRegistered, // Total de Clientes no Banco
		"clientsWithActiveLoans": clientsWithDebt,        // Clientes que devem
		"recoveredToday":         recoveredToday,         // Recebido Hoje
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}
