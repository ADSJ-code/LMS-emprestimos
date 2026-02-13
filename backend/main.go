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
		jwtKey = []byte("secret_key_123_mudar_em_producao")
	}
}

// --- MIDDLEWARES ---

func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Token não fornecido", http.StatusUnauthorized)
			return
		}
		bearerToken := strings.Split(authHeader, " ")
		if len(bearerToken) != 2 {
			http.Error(w, "Token malformado", http.StatusUnauthorized)
			return
		}
		tokenString := bearerToken[1]
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		})
		if err != nil || !token.Valid {
			http.Error(w, "Token inválido", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), "username", claims.Username)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func adminMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Reutiliza lógica de validação básica ou reimplementa para garantir
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Acesso negado", http.StatusUnauthorized)
			return
		}
		bearerToken := strings.Split(authHeader, " ")
		if len(bearerToken) != 2 {
			http.Error(w, "Token inválido", http.StatusUnauthorized)
			return
		}
		tokenString := bearerToken[1]
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		})

		if err != nil || !token.Valid {
			http.Error(w, "Token inválido", http.StatusUnauthorized)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var user User
		err = userCollection.FindOne(ctx, bson.M{"username": claims.Username}).Decode(&user)

		if err != nil || strings.ToUpper(user.Role) != "ADMIN" {
			logAction("ACESSO NEGADO ADMIN", claims.Username)
			http.Error(w, "Acesso restrito a Administradores.", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	}
}

// --- FUNÇÕES AUXILIARES ---

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func logAction(action string, details string) {
	fmt.Printf("\033[32m[AUDITORIA %s]\033[0m %s - %s\n", time.Now().Format("15:04:05"), action, details)
	if logCollection != nil {
		entry := LogEntry{
			ID:        primitive.NewObjectID().Hex(),
			Action:    action,
			User:      "Sistema",
			Details:   details,
			Timestamp: time.Now(),
		}
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			logCollection.InsertOne(ctx, entry)
		}()
	}
}

func logSysAction(action string, details string) {
	if logCollection != nil {
		entry := LogEntry{
			ID:        primitive.NewObjectID().Hex(),
			Action:    action,
			User:      "Sistema",
			Details:   details,
			Timestamp: time.Now(),
		}
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			logCollection.InsertOne(ctx, entry)
		}()
	}
}

// --- BACKGROUND ---

func StartBackgroundSystemLogs() {
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		time.Sleep(5 * time.Second)
		logSysAction("Sistema Iniciado", "Servidor online.")
		for range ticker.C {
			logSysAction("Monitoramento", "Integridade OK.")
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
			time.Sleep(time.Until(nextRun))
			performInternalBackup()
		}
	}()
}

func performInternalBackup() {
	log.Println("🔄 Backup Automático...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	db := mongoClient.Database("lms")
	cursor, _ := clientCollection.Find(ctx, bson.M{})
	var clients []interface{}
	if err := cursor.All(ctx, &clients); err == nil && len(clients) > 0 {
		db.Collection("clients_backup").Drop(ctx)
		db.Collection("clients_backup").InsertMany(ctx, clients)
	}

	cursorLoans, _ := loanCollection.Find(ctx, bson.M{})
	var loans []interface{}
	if err := cursorLoans.All(ctx, &loans); err == nil && len(loans) > 0 {
		db.Collection("loans_backup").Drop(ctx)
		db.Collection("loans_backup").InsertMany(ctx, loans)
	}
	logSysAction("BACKUP AUTOMÁTICO", "Sucesso.")
}

// --- STRUCTS ---

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
	WarningDays  int  `json:"warningDays" bson:"warningDays"`
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
	MoraInterestRate    float64         `json:"moraInterestRate" bson:"moraInterestRate"`
	ClientBank          string          `json:"clientBank" bson:"clientBank"`
	PaymentMethod       string          `json:"paymentMethod" bson:"paymentMethod"`
	Justification       string          `json:"justification,omitempty" bson:"justification,omitempty"`
	ChecklistAtApproval []string        `json:"checklistAtApproval,omitempty" bson:"checklistAtApproval,omitempty"`
	TotalPaidInterest   float64         `json:"totalPaidInterest" bson:"totalPaidInterest"`
	TotalPaidCapital    float64         `json:"totalPaidCapital" bson:"totalPaidCapital"`
	History             []PaymentRecord `json:"history" bson:"history"`

	InterestType     string  `json:"interestType,omitempty" bson:"interestType,omitempty"`
	Frequency        string  `json:"frequency,omitempty" bson:"frequency,omitempty"`
	ProjectedProfit  float64 `json:"projectedProfit,omitempty" bson:"projectedProfit,omitempty"`
	AgreementDate    string  `json:"agreementDate,omitempty" bson:"agreementDate,omitempty"`
	AgreementValue   float64 `json:"agreementValue,omitempty" bson:"agreementValue,omitempty"`
	GuarantorName    string  `json:"guarantorName,omitempty" bson:"guarantorName,omitempty"`
	GuarantorCPF     string  `json:"guarantorCPF,omitempty" bson:"guarantorCPF,omitempty"`
	GuarantorAddress string  `json:"guarantorAddress,omitempty" bson:"guarantorAddress,omitempty"`
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var err error
	mongoClient, err = mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		log.Fatal("Falha ao conectar ao MongoDB:", err)
	}

	err = mongoClient.Ping(ctx, nil)
	if err != nil {
		log.Fatal("Não foi possível pingar o MongoDB:", err)
	}

	db := mongoClient.Database("lms")
	loanCollection = db.Collection("loans")
	clientCollection = db.Collection("clients")
	userCollection = db.Collection("users")
	affiliateCollection = db.Collection("affiliates")
	logCollection = db.Collection("logs")
	blacklistCollection = db.Collection("blacklist")
	settingsCollection = db.Collection("settings")
	log.Println("✅ MongoDB Conectado!")

	seedAdminUser()
	StartBackgroundSystemLogs()
	StartDailyBackupRoutine()

	mux := http.NewServeMux()

	mux.HandleFunc("/api/auth/login", loginHandler)
	mux.HandleFunc("/api/users", authMiddleware(usersHandler))
	mux.HandleFunc("/api/users/", authMiddleware(userDetailHandler))
	mux.HandleFunc("/api/loans", authMiddleware(loansHandler))
	mux.HandleFunc("/api/loans/", authMiddleware(loanUpdateHandler))
	mux.HandleFunc("/api/clients", authMiddleware(clientsHandler))
	mux.HandleFunc("/api/clients/", authMiddleware(clientUpdateHandler))
	mux.HandleFunc("/api/affiliates", authMiddleware(affiliatesHandler))
	mux.HandleFunc("/api/affiliates/", authMiddleware(affiliateUpdateHandler))
	mux.HandleFunc("/api/blacklist", authMiddleware(blacklistHandler))
	mux.HandleFunc("/api/blacklist/", authMiddleware(blacklistUpdateHandler))
	mux.HandleFunc("/api/logs", authMiddleware(logsHandler))
	mux.HandleFunc("/api/settings", authMiddleware(settingsHandler))
	mux.HandleFunc("/api/dashboard/summary", authMiddleware(dashboardSummaryHandler))

	mux.HandleFunc("/api/admin/reset", adminMiddleware(resetDatabaseHandler))
	mux.HandleFunc("/api/admin/restore", adminMiddleware(restoreDatabaseHandler))

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
			http.Error(w, "Erro Crítico: Pasta 'dist' não encontrada.", http.StatusInternalServerError)
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
	log.Println("🚀 Servidor rodando na porta :" + port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func seedAdminUser() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var user User
	err := userCollection.FindOne(ctx, bson.M{"username": "admin@creditnow.com"}).Decode(&user)
	if err == mongo.ErrNoDocuments {
		log.Println("⚠️ Admin não encontrado. Criando agora...")
		hash, _ := hashPassword("123456")
		user = User{
			ID:       primitive.NewObjectID().Hex(),
			Name:     "Admin",
			Username: "admin@creditnow.com",
			Password: hash,
			Role:     "ADMIN",
		}
		userCollection.InsertOne(ctx, user)
	} else if err == nil && user.Role != "ADMIN" {
		userCollection.UpdateOne(ctx, bson.M{"username": "admin@creditnow.com"}, bson.M{"$set": bson.M{"role": "ADMIN"}})
	}
}

// --- HANDLERS ---

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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var storedUser User
	if err := userCollection.FindOne(ctx, bson.M{"username": creds.Username}).Decode(&storedUser); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if !checkPasswordHash(creds.Password, storedUser.Password) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	exp := time.Now().Add(24 * time.Hour)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, &Claims{Username: creds.Username, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(exp)}})
	tokenStr, _ := token.SignedString(jwtKey)
	storedUser.Password = ""
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"token": tokenStr, "user": storedUser})
}

func usersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, _ := userCollection.Find(ctx, bson.M{})
		var results []User
		cursor.All(ctx, &results)
		for i := range results {
			results[i].Password = ""
		}
		json.NewEncoder(w).Encode(results)
	case http.MethodPost:
		var u User
		json.NewDecoder(r.Body).Decode(&u)
		if u.Username == "" || u.Password == "" {
			http.Error(w, "Incompleto", http.StatusBadRequest)
			return
		}
		count, _ := userCollection.CountDocuments(ctx, bson.M{"username": u.Username})
		if count > 0 {
			http.Error(w, "Já existe", http.StatusConflict)
			return
		}
		u.Password, _ = hashPassword(u.Password)
		u.ID = primitive.NewObjectID().Hex()
		u.Role = "OPERATOR"
		userCollection.InsertOne(ctx, u)
		w.WriteHeader(http.StatusCreated)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func userDetailHandler(w http.ResponseWriter, r *http.Request) {
	email := strings.TrimPrefix(r.URL.Path, "/api/users/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var d struct {
			Password string `json:"password"`
		}
		json.NewDecoder(r.Body).Decode(&d)
		if d.Password != "" {
			hash, _ := hashPassword(d.Password)
			userCollection.UpdateOne(ctx, bson.M{"username": email}, bson.M{"$set": bson.M{"password": hash}})
			w.WriteHeader(http.StatusOK)
		}
	case http.MethodDelete:
		userCollection.DeleteOne(ctx, bson.M{"username": email})
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func loansHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
		var c Client
		clientCollection.FindOne(ctx, bson.M{"name": l.Client}).Decode(&c)
		count, _ := blacklistCollection.CountDocuments(ctx, bson.M{"cpf": c.CPF})
		if count > 0 {
			http.Error(w, "Blacklist", http.StatusForbidden)
			return
		}
		if l.History == nil {
			l.History = []PaymentRecord{}
		}
		loanCollection.InsertOne(ctx, l)
		logAction("NOVO EMPRÉSTIMO", l.Client)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(l)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func loanUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/loans/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var l Loan
		json.NewDecoder(r.Body).Decode(&l)
		var cap, jur float64
		for _, rec := range l.History {
			if rec.Type != "Abertura" && rec.Type != "Acordo" {
				cap += rec.CapitalPaid
				jur += rec.InterestPaid
			}
		}
		l.TotalPaidCapital = cap
		l.TotalPaidInterest = jur
		if l.Amount <= 0.10 {
			l.Status = "Pago"
		} else if l.Status == "Pago" {
			l.Status = "Em Dia"
		}
		loanCollection.ReplaceOne(ctx, bson.M{"id": id}, l)
		json.NewEncoder(w).Encode(l)
	case http.MethodDelete:
		loanCollection.DeleteOne(ctx, bson.M{"id": id})
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func clientsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
		count, _ := blacklistCollection.CountDocuments(ctx, bson.M{"cpf": c.CPF})
		if count > 0 {
			http.Error(w, "Blacklist", http.StatusForbidden)
			return
		}
		if c.ID == 0 {
			c.ID = time.Now().UnixNano() / 1e6
		}
		clientCollection.InsertOne(ctx, c)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(c)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func clientUpdateHandler(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/clients/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
		json.NewEncoder(w).Encode(c)
	case http.MethodDelete:
		clientCollection.DeleteOne(ctx, filter)
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func affiliatesHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, _ := affiliateCollection.Find(ctx, bson.M{})
		var res []Affiliate
		cursor.All(ctx, &res)
		if res == nil {
			res = []Affiliate{}
		}
		json.NewEncoder(w).Encode(res)
	case http.MethodPost:
		var a Affiliate
		json.NewDecoder(r.Body).Decode(&a)
		if a.ID == "" {
			a.ID = primitive.NewObjectID().Hex()
		}
		affiliateCollection.InsertOne(ctx, a)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(a)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func affiliateUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/affiliates/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var a Affiliate
		json.NewDecoder(r.Body).Decode(&a)
		affiliateCollection.ReplaceOne(ctx, bson.M{"id": id}, a)
		json.NewEncoder(w).Encode(a)
	case http.MethodDelete:
		affiliateCollection.DeleteOne(ctx, bson.M{"id": id})
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func blacklistHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		cursor, _ := blacklistCollection.Find(ctx, bson.M{})
		var res []BlacklistEntry
		cursor.All(ctx, &res)
		if res == nil {
			res = []BlacklistEntry{}
		}
		json.NewEncoder(w).Encode(res)
	case http.MethodPost:
		var b BlacklistEntry
		json.NewDecoder(r.Body).Decode(&b)
		if b.ID == "" {
			b.ID = primitive.NewObjectID().Hex()
		}
		blacklistCollection.InsertOne(ctx, b)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(b)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func blacklistUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/blacklist/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodPut:
		var b BlacklistEntry
		json.NewDecoder(r.Body).Decode(&b)
		blacklistCollection.ReplaceOne(ctx, bson.M{"id": id}, b)
		json.NewEncoder(w).Encode(b)
	case http.MethodDelete:
		blacklistCollection.DeleteOne(ctx, bson.M{"id": id})
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func settingsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		var s Settings
		err := settingsCollection.FindOne(ctx, bson.M{}).Decode(&s)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{})
		} else {
			json.NewEncoder(w).Encode(s)
		}
	case http.MethodPost, http.MethodPut:
		var s Settings
		json.NewDecoder(r.Body).Decode(&s)
		opts := options.Replace().SetUpsert(true)
		settingsCollection.ReplaceOne(ctx, bson.M{}, s, opts)
		json.NewEncoder(w).Encode(s)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func logsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if r.Method == http.MethodGet {
		cursor, _ := logCollection.Find(ctx, bson.M{})
		var res []LogEntry
		cursor.All(ctx, &res)
		if res == nil {
			res = []LogEntry{}
		}
		json.NewEncoder(w).Encode(res)
	} else {
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func dashboardSummaryHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	totalActive, _ := loanCollection.CountDocuments(ctx, bson.M{"status": bson.M{"$ne": "Pago"}})
	totalOverdue, _ := loanCollection.CountDocuments(ctx, bson.M{"status": "Atrasado"})
	totalClients, _ := clientCollection.CountDocuments(ctx, bson.M{})

	pipeline := []bson.M{
		{"$match": bson.M{"status": bson.M{"$ne": "Pago"}}},
		{"$group": bson.M{"_id": nil, "totalCapital": bson.M{"$sum": bson.M{"$subtract": []interface{}{bson.M{"$ifNull": []interface{}{"$amount", 0}}, bson.M{"$ifNull": []interface{}{"$totalPaidCapital", 0}}}}}}},
	}
	cursorCap, _ := loanCollection.Aggregate(ctx, pipeline)
	var resCap []bson.M
	cursorCap.All(ctx, &resCap)
	var capital float64
	if len(resCap) > 0 {
		if val, ok := resCap[0]["totalCapital"].(float64); ok {
			capital = val
		}
	}

	today := time.Now().Format("2006-01-02")
	cursorToday, _ := loanCollection.Find(ctx, bson.M{"history.date": bson.M{"$regex": today}})
	var loansToday []Loan
	cursorToday.All(ctx, &loansToday)
	var recToday float64
	for _, l := range loansToday {
		for _, h := range l.History {
			if strings.HasPrefix(h.Date, today) && h.Type != "Abertura" && h.Type != "Acordo" {
				recToday += h.Amount
			}
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"totalActive":       totalActive,
		"totalOverdue":      totalOverdue,
		"totalCapital":      capital,
		"clientsRegistered": totalClients,
		"recoveredToday":    recToday,
	})
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
		var c []interface{}
		for _, v := range data.Clients {
			c = append(c, v)
		}
		clientCollection.InsertMany(ctx, c)
	}
	if len(data.Loans) > 0 {
		var l []interface{}
		for _, v := range data.Loans {
			l = append(l, v)
		}
		loanCollection.InsertMany(ctx, l)
	}
	if len(data.Users) > 0 {
		var u []interface{}
		for _, v := range data.Users {
			u = append(u, v)
		}
		userCollection.InsertMany(ctx, u)
	} else {
		seedAdminUser()
	}
	settingsCollection.InsertOne(ctx, data.Settings)
	logAction("RESTAURAÇÃO", "Sistema restaurado.")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Sucesso!"})
}
