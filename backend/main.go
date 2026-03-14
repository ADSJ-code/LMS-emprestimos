package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
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

// --- Middlewares ---

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

// --- Helpers de Segurança ---

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// --- Auditoria e Logs ---

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

// --- Backup ---

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
	// CORREÇÃO AQUI: time.Minute em vez de minute
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	db := mongoClient.Database("creditnow")
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

// --- Estruturas de Dados ---

type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

type User struct {
	ID       string `json:"id,omitempty" bson:"_id,omitempty"`
	Name     string `json:"name" bson:"name"`
	Username string `json:"email" bson:"username"` // Recebe como email, salva como username
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
	Date            string  `json:"date" bson:"date"`
	Amount          float64 `json:"amount" bson:"amount"`
	CapitalPaid     float64 `json:"capitalPaid" bson:"capitalPaid"`
	InterestPaid    float64 `json:"interestPaid" bson:"interestPaid"`
	Type            string  `json:"type" bson:"type"`
	Note            string  `json:"note" bson:"note"`
	RegisteredAt    string  `json:"registeredAt" bson:"registeredAt"`
	OriginalDueDate string  `json:"originalDueDate,omitempty" bson:"originalDueDate,omitempty"`
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
	InterestType        string          `json:"interestType,omitempty" bson:"interestType,omitempty"`
	Frequency           string          `json:"frequency,omitempty" bson:"frequency,omitempty"`
	ProjectedProfit     float64         `json:"projectedProfit,omitempty" bson:"projectedProfit,omitempty"`
	AgreementDate       string          `json:"agreementDate,omitempty" bson:"agreementDate,omitempty"`
	AgreementValue      float64         `json:"agreementValue,omitempty" bson:"agreementValue,omitempty"`
	GuarantorName       string          `json:"guarantorName,omitempty" bson:"guarantorName,omitempty"`
	GuarantorCPF        string          `json:"guarantorCPF,omitempty" bson:"guarantorCPF,omitempty"`
	GuarantorAddress    string          `json:"guarantorAddress,omitempty" bson:"guarantorAddress,omitempty"`
	AffiliateName       string          `json:"affiliateName,omitempty" bson:"affiliateName,omitempty"`
	AffiliateFee        float64         `json:"affiliateFee,omitempty" bson:"affiliateFee,omitempty"`
	AffiliateNotes      string          `json:"affiliateNotes,omitempty" bson:"affiliateNotes,omitempty"`
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

// --- Principal ---

func main() {
	mongoURI := os.Getenv("MONGO_URI")
	if mongoURI == "" {
		mongoURI = "mongodb://root2:1rGay2HQa0DCH1TTQwXc3CqKF0-wXHUqRVb6jgfGQq2_e5bS@be2f531d-55bf-427a-ba07-502009ee1f10.southamerica-east1.firestore.goog:443/creditnow?loadBalanced=true&tls=true&authMechanism=SCRAM-SHA-256&retryWrites=false"
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

	db := mongoClient.Database("creditnow")
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

	waSvc := NewWhatsappService()
	waCtrl := NewWhatsappController(waSvc)

	mux := http.NewServeMux()

	// Auth
	mux.HandleFunc("/api/auth/login", loginHandler)
	
	// Rotas protegidas
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

	// WhatsApp
	mux.HandleFunc("/api/message", waCtrl.EnviarMensagem)
	mux.HandleFunc("/api/instances/ver", waCtrl.VerInstancias)
	mux.HandleFunc("/api/instances/criar", waCtrl.CriarInstanciaMsg)
	mux.HandleFunc("/api/instances/conectar", waCtrl.ConectarInstancia)

	// Admin
	mux.HandleFunc("/api/admin/reset", adminMiddleware(resetDatabaseHandler))
	mux.HandleFunc("/api/admin/restore", adminMiddleware(restoreDatabaseHandler))

	// SPA Server (Frontend)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		possiveisCaminhos := []string{"dist", "backend/dist", "../backend/dist"}
		var caminhoDist string
		for _, p := range possiveisCaminhos {
			if info, err := os.Stat(p); err == nil && info.IsDir() {
				caminhoDist = p
				break
			}
		}

		// Se não achar a pasta dist, apenas avisa e não trava a API
		if caminhoDist == "" {
			if strings.HasPrefix(r.URL.Path, "/api") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprintf(w, "<h3>Backend Ativo</h3><p>Pasta 'dist' não encontrada. Rode 'npm run build' no React.</p>")
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

// --- Handlers de Login e Usuário ---

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// BLINDAGEM: Lê o JSON aceitando tanto "email" (React) quanto "Username" (Go)
	var creds struct {
		Username string `json:"email"`    
		Password string `json:"password"` 
	}

	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil || creds.Username == "" {
		// Fallback para Iniciais Maiúsculas se o frontend enviar assim
		var credsUpper struct {
			Username string `json:"Username"`
			Password string `json:"Password"`
		}
		json.Unmarshal(bodyBytes, &credsUpper)
		if credsUpper.Username != "" {
			creds.Username = credsUpper.Username
			creds.Password = credsUpper.Password
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var storedUser User
	if err := userCollection.FindOne(ctx, bson.M{"username": creds.Username}).Decode(&storedUser); err != nil {
		// Tenta buscar pelo campo 'username' puramente (caso do 'admin' sem @)
		err = userCollection.FindOne(ctx, bson.M{"username": creds.Username}).Decode(&storedUser)
		if err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
	}

	// BLINDAGEM: Aceita senha Bcrypt OU texto puro (para testes)
	if !checkPasswordHash(creds.Password, storedUser.Password) && creds.Password != storedUser.Password {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	exp := time.Now().Add(24 * time.Hour)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, &Claims{
		Username: storedUser.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	})
	tokenStr, _ := token.SignedString(jwtKey)

	storedUser.Password = ""
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"token": tokenStr, "user": storedUser})
}

// --- Handlers de API (Resumidos) ---

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
		u.Password, _ = hashPassword(u.Password)
		u.ID = primitive.NewObjectID().Hex()
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

// Empréstimos
func loansHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if r.Method == http.MethodGet {
		cursor, _ := loanCollection.Find(ctx, bson.M{})
		var results []Loan
		cursor.All(ctx, &results)
		if results == nil { results = []Loan{} }
		json.NewEncoder(w).Encode(results)
	} else if r.Method == http.MethodPost {
		var l Loan
		json.NewDecoder(r.Body).Decode(&l)
		l.ID = primitive.NewObjectID().Hex()
		loanCollection.InsertOne(ctx, l)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(l)
	}
}

func loanUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/loans/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if r.Method == http.MethodPut {
		var l Loan
		json.NewDecoder(r.Body).Decode(&l)
		loanCollection.ReplaceOne(ctx, bson.M{"id": id}, l)
		json.NewEncoder(w).Encode(l)
	} else if r.Method == http.MethodDelete {
		loanCollection.DeleteOne(ctx, bson.M{"id": id})
		w.WriteHeader(http.StatusNoContent)
	}
}

// Clientes
func clientsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if r.Method == http.MethodGet {
		cursor, _ := clientCollection.Find(ctx, bson.M{})
		var results []Client
		cursor.All(ctx, &results)
		if results == nil { results = []Client{} }
		json.NewEncoder(w).Encode(results)
	} else if r.Method == http.MethodPost {
		var c Client
		json.NewDecoder(r.Body).Decode(&c)
		if c.ID == 0 { c.ID = time.Now().UnixNano() / 1e6 }
		clientCollection.InsertOne(ctx, c)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(c)
	}
}

func clientUpdateHandler(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/clients/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	id, _ := strconv.ParseInt(idStr, 10, 64)
	if r.Method == http.MethodPut {
		var c Client
		json.NewDecoder(r.Body).Decode(&c)
		clientCollection.ReplaceOne(ctx, bson.M{"id": id}, c)
		json.NewEncoder(w).Encode(c)
	} else if r.Method == http.MethodDelete {
		clientCollection.DeleteOne(ctx, bson.M{"id": id})
		w.WriteHeader(http.StatusNoContent)
	}
}

// --- Restante das Funções Auxiliares (WhatsApp, Settings, Dashboard) ---

func affiliatesHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cursor, _ := affiliateCollection.Find(ctx, bson.M{})
	var res []Affiliate
	cursor.All(ctx, &res)
	if res == nil { res = []Affiliate{} }
	json.NewEncoder(w).Encode(res)
}

func affiliateUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/affiliates/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if r.Method == http.MethodDelete {
		affiliateCollection.DeleteOne(ctx, bson.M{"id": id})
		w.WriteHeader(http.StatusNoContent)
	}
}

func blacklistHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cursor, _ := blacklistCollection.Find(ctx, bson.M{})
	var res []BlacklistEntry
	cursor.All(ctx, &res)
	if res == nil { res = []BlacklistEntry{} }
	json.NewEncoder(w).Encode(res)
}

func blacklistUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/blacklist/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if r.Method == http.MethodDelete {
		blacklistCollection.DeleteOne(ctx, bson.M{"id": id})
		w.WriteHeader(http.StatusNoContent)
	}
}

func settingsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if r.Method == http.MethodGet {
		var s Settings
		settingsCollection.FindOne(ctx, bson.M{}).Decode(&s)
		json.NewEncoder(w).Encode(s)
	} else {
		var s Settings
		json.NewDecoder(r.Body).Decode(&s)
		opts := options.Replace().SetUpsert(true)
		settingsCollection.ReplaceOne(ctx, bson.M{}, s, opts)
		json.NewEncoder(w).Encode(s)
	}
}

func logsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cursor, _ := logCollection.Find(ctx, bson.M{})
	var res []LogEntry
	cursor.All(ctx, &res)
	if res == nil { res = []LogEntry{} }
	json.NewEncoder(w).Encode(res)
}

func dashboardSummaryHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	totalActive, _ := loanCollection.CountDocuments(ctx, bson.M{"status": bson.M{"$ne": "Pago"}})
	totalClients, _ := clientCollection.CountDocuments(ctx, bson.M{})
	json.NewEncoder(w).Encode(map[string]interface{}{
		"totalActive":       totalActive,
		"clientsRegistered": totalClients,
	})
}

func resetDatabaseHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	loanCollection.Drop(ctx)
	clientCollection.Drop(ctx)
	userCollection.Drop(ctx)
	seedAdminUser()
	w.WriteHeader(http.StatusOK)
}

func restoreDatabaseHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNotImplemented)
}

// --- WhatsApp Logic ---

type WhatsappController struct {
	svc WhatsappService
}

func NewWhatsappController(s WhatsappService) *WhatsappController {
	return &WhatsappController{svc: s}
}

func (ctrl *WhatsappController) EnviarMensagem(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserConectado string `json:"userConectado" binding:"required"`
		Phone      string `json:"phone" binding:"required"`
		Message    string `json:"message"`
		Delay	  int    `json:"delay"`
		Name      string `json:"name"`
		LateDays  int    `json:"lateDays"`
		UpdatedAmount float64 `json:"updatedAmount"`
		DateVencimento string `json:"dateVencimento"`
		ApiKey string `json:"apiKey" binding:"required"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	err := ctrl.svc.SendMessage(r.Context(), body.UserConectado, body.Phone, body.Message, body.Delay, body.Name, body.LateDays, body.UpdatedAmount, body.DateVencimento, body.ApiKey)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.WriteHeader(200)
}

func (ctrl *WhatsappController) VerInstancias(w http.ResponseWriter, r *http.Request) {
	res, err := ctrl.svc.ViewInstances(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	json.NewEncoder(w).Encode(res)
}

func (ctrl *WhatsappController) CriarInstanciaMsg(w http.ResponseWriter, r *http.Request) {
	var body CreateInstance
	json.NewDecoder(r.Body).Decode(&body)
	instance, err := ctrl.svc.CreateInstance(r.Context(), body.Name, body.Phone)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	respMap, ok := instance.(map[string]interface{})

	if ok {
		if _, hasError := respMap["error"]; hasError {
			// Define o Header como JSON
			w.Header().Set("Content-Type", "application/json")
			
			// Define o Status Code (equivalente ao http.StatusForbidden)
			w.WriteHeader(http.StatusForbidden)
			
			// Cria a estrutura de resposta manualmente
			response := map[string]interface{}{
				"status":  "Falha ao criar instância na API",
				"details": instance,
			}
			
			// Codifica e envia
			json.NewEncoder(w).Encode(response)
			return
		}
	}

	json.NewEncoder(w).Encode(instance)
}

func (ctrl *WhatsappController) ConectarInstancia(w http.ResponseWriter, r *http.Request) {
	var body CreateInstance
	json.NewDecoder(r.Body).Decode(&body)
	res, _ := ctrl.svc.ConnectInstance(r.Context(), body.Name, body.Phone)
	json.NewEncoder(w).Encode(res)
}

type WhatsappService interface {
	SendMessage(ctx context.Context, inst, phone, msg string, delay int, name string, days int, amt float64, due, key string) error
	ViewInstances(ctx context.Context) ([]InstanceResponse, error)
	CreateInstance(ctx context.Context, name, phone string) (interface{}, error)
	ConnectInstance(ctx context.Context, name, phone string) (interface{}, error)
}

type whatsappService struct {
	ApiURL, ApiToken, ApiGlobalKey string
}

func NewWhatsappService() WhatsappService {
	return &whatsappService{
		ApiURL:       "http://34.69.98.196:8080",
		ApiToken:     "5E603D2122C0-42C5-AFAD-FE1E8C0A3791",
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


func (s *whatsappService) SendMessage(ctx context.Context, userConectado string, phone string, message string, delayLevel int, name string, lateDays int, updatedAmount float64, dateVencimento string, apiKey string) error {
	// mensagem personalizada
	message = DefinirMensagemComDetalhes(delayLevel, name, lateDays, updatedAmount, dateVencimento)

	// Limpeza e formatação do número de telefone
	re := regexp.MustCompile(`\D`)
	phoneLimpo := re.ReplaceAllString(phone, "")
	if len(phoneLimpo) < 13 && len(phoneLimpo) >= 10 {
		phoneLimpo = "55" + phoneLimpo
	}

	// Montagem da URL e do Payload
	url := fmt.Sprintf("%s/message/sendText/%s", s.ApiURL, userConectado)
	
	payload := MessagePayload{
		Number: phoneLimpo,
		Options: Options{
			Delay:    1200,
			Presence: "composing",
		},
		TextMessage: TextMessage{
			Text: message,
		},
	}

	// Preparação da requisição
	b, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("falha ao criar payload: %v", err)
	}

	// Envia para a API externa
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(b))
	if err != nil {
		return fmt.Errorf("falha ao criar requisição: %v", err)
	}

	// Adiciona os headers necessários
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", apiKey)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36")

	// Configura o client com timeout e envia a requisição
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Lê a resposta
	body, _ := io.ReadAll(resp.Body)
	log.Printf("Status: %s\nResposta: %s\n", resp.Status, string(body))

	return err
}
func DefinirMensagemComDetalhes(delayLevel int, name string, lateDays int, updatedAmount float64, dateVencimento string) string {
	// Formatação simples para moeda (R$)
	valorFormatado := fmt.Sprintf("R$ %.2f", updatedAmount)
	
	switch delayLevel {
	case 1:
		// Lembrete de Atraso=
		return fmt.Sprintf(
			"Olá, *%s*! \n\nNotamos que o seu pagamento da Credit Now ainda não consta em nosso sistema.\n\n" +
			"📌 *Detalhes:*\n• Valor: %s\n• Atraso: %d dia(s)\n\n" +
			"Sabemos que imprevistos acontecem! Podemos te ajudar a regularizar isso hoje com uma condição especial? 💸", 
			name, valorFormatado, lateDays)

	case 2:
		// Lembrete de Vencimento Próximo
		return fmt.Sprintf(
			"Olá, *%s*! Tudo bem? ⚠️\n\n"+
			"Passando para lembrar do vencimento da sua parcela no valor de  *%s* no dia %s Qualquer dúvida, estamos à disposição!\n\n",
			name, valorFormatado, dateVencimento)

	case 3:
		// Lembrete de Atraso Avançado
		return fmt.Sprintf(
			"🚨 *NOTIFICAÇÃO URGENTE* - %s\n\n*%s*, tentamos diversos contatos sem sucesso.\n\n" +
			"O débito de %s está em fase avançada de atraso (%d dias). Para evitar o envio do seu CPF aos órgãos de proteção ao crédito (SPC/Serasa), responda esta mensagem imediatamente para negociar. 🚫", 
			name, name, valorFormatado, lateDays)

	default:
		// Mensagem Genérica para outros casos
		return "Olá! Identificamos uma pendência em seu cadastro na Credit Now. Por favor, entre em contato com nosso suporte para verificarmos as opções de pagamento disponíveis."
	}
		

}

func (s *whatsappService) ViewInstances(ctx context.Context) ([]InstanceResponse, error) {
	url := s.ApiURL + "/instance/fetchInstances"

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil { return nil, err }

	// Adiciona o header de autenticação
	req.Header.Set("apikey", s.ApiGlobalKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()

	// Decodifica a resposta JSON em uma estrutura Go
	var res []InstanceResponse
	json.NewDecoder(resp.Body).Decode(&res)
	return res, err
}

func (s *whatsappService) CreateInstance(ctx context.Context, name, phone string) (interface{}, error) {
	url := s.ApiURL + "/instance/create"

	log.Printf("Criando instância com nome: %s e telefone: %s", name, phone)

	// Prepara os dados para criação da instância
	payload := CreateInstancePayload{
		Name:   name,
		QRCode: true, // Solicita geração de QR Code para autenticação
		Phone:  phone,
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	// Cria a requisição HTTP POST para criar a instância
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(b))
	if err != nil {
		return nil, err
	}

	// Configuração dos Headers
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", s.ApiGlobalKey)

	// Uso de um client com timeout para evitar que a requisição trave o sistema
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var res interface{}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}

	return res, err
}

func (s *whatsappService) ConnectInstance(ctx context.Context, name, phone string) (interface{}, error) {
	// Tirar caracteres não numéricos do telefone
	re := regexp.MustCompile(`\D`)
	phoneLimpo := re.ReplaceAllString(phone, "")
	if len(phoneLimpo) < 13 && len(phoneLimpo) >= 10 {
		phoneLimpo = "55" + phoneLimpo
	}

	// Montar a URL 
	url := fmt.Sprintf("%s/instance/connect/%s?number=%s", s.ApiURL, name, phoneLimpo)

	log.Printf("Conectando instância '%s' com número '%s'", name, phoneLimpo)

	// Criação da requisição
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	// Configuração dos Headers
	req.Header.Set("apikey", s.ApiGlobalKey)
	req.Header.Set("Accept", "application/json")

	// Execução com Timeout de 30s (importante para o QR Code não dar timeout)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Decodificação da resposta
	var res interface{}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, err
	}

	return res, err
}

// --- Structs de Resposta de Terceiros ---

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