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
	Username string `json:"email" bson:"username"`
	Password string `json:"password,omitempty" bson:"password"`
	Role     string `json:"role" bson:"role"`
}

type CompanySettings struct {
	Name     string `json:"name" bson:"name"`
	CNPJ     string `json:"cnpj" bson:"cnpj"`
	PixKey   string `json:"pixKey" bson:"pixKey"`
	Email    string `json:"email" bson:"email"`
	Phone    string `json:"phone" bson:"phone"`
	Address  string `json:"address" bson:"address"`
	City     string `json:"city"`
	BankName string `json:"bankName"`
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

type MultiDate struct {
	Day    int     `json:"day" bson:"day"`
	Amount float64 `json:"amount" bson:"amount"`
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
	MultiDates          []MultiDate     `json:"multiDates,omitempty" bson:"multiDates,omitempty"`
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
	mux.HandleFunc("/api/instances/desconectar", waCtrl.DesconectarInstancia)

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

// --- HANDLER DE LOGIN ---

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	var raw map[string]interface{}
	json.Unmarshal(bodyBytes, &raw)

	var username, password string
	if v, ok := raw["email"]; ok {
		username = fmt.Sprintf("%v", v)
	}
	if v, ok := raw["username"]; ok && username == "" {
		username = fmt.Sprintf("%v", v)
	}
	if v, ok := raw["password"]; ok {
		password = fmt.Sprintf("%v", v)
	}

	username = strings.ToLower(strings.TrimSpace(username))
	password = strings.TrimSpace(password)

	if username == "" || password == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var storedUser User
	filter := bson.M{"username": bson.M{"$regex": primitive.Regex{Pattern: "^" + regexp.QuoteMeta(username) + "$", Options: "i"}}}
	err := userCollection.FindOne(ctx, filter).Decode(&storedUser)

	if err != nil || (!checkPasswordHash(password, storedUser.Password) && password != storedUser.Password) {
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

// --- Handlers de API ---

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

// --- LÓGICA DE ID SEQUENCIAL APLICADA AQUI ---

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
		// 1. Lemos o pacote bruto enviado pelo React
		bodyBytes, _ := io.ReadAll(r.Body)

		var l Loan
		json.Unmarshal(bodyBytes, &l)

		// 2. A MARRETA: Extraímos o ID à força caso o Go tenha ignorado na etapa anterior
		var raw map[string]interface{}
		json.Unmarshal(bodyBytes, &raw)
		if customID, ok := raw["id"].(string); ok && customID != "" {
			l.ID = customID
		}

		// 3. Se mesmo assim estiver vazio (o usuário não digitou nada), gera automático
		if l.ID == "" {
			opts := options.FindOne().SetSort(bson.M{"id": -1})
			var lastLoan Loan
			err := loanCollection.FindOne(ctx, bson.M{"id": bson.M{"$regex": "^[0-9]+$"}}, opts).Decode(&lastLoan)

			nextNum := 1
			if err == nil {
				if val, err := strconv.Atoi(lastLoan.ID); err == nil {
					nextNum = val + 1
				}
			}
			// Formata com 4 dígitos (ex: "0001", "0227")
			l.ID = fmt.Sprintf("%04d", nextNum)
		}

		loanCollection.InsertOne(ctx, l)
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
	id, _ := strconv.ParseInt(idStr, 10, 64)

	switch r.Method {
	case http.MethodPut:
		var c Client
		json.NewDecoder(r.Body).Decode(&c)
		clientCollection.ReplaceOne(ctx, bson.M{"id": id}, c)
		json.NewEncoder(w).Encode(c)
	case http.MethodDelete:
		clientCollection.DeleteOne(ctx, bson.M{"id": id})
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
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func affiliateUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/affiliates/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
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
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func blacklistUpdateHandler(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/blacklist/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	switch r.Method {
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
		settingsCollection.FindOne(ctx, bson.M{}).Decode(&s)
		json.NewEncoder(w).Encode(s)
	case http.MethodPost:
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

	switch r.Method {
	case http.MethodGet:
		// Busca todos os logs do banco de dados (Sincronia total)
		cursor, _ := logCollection.Find(ctx, bson.M{})
		var res []LogEntry
		cursor.All(ctx, &res)
		if res == nil {
			res = []LogEntry{}
		}
		json.NewEncoder(w).Encode(res)

	case http.MethodPost:
		// Recebe uma nova ação do Frontend e grava no MongoDB
		var entry LogEntry
		if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
			http.Error(w, "Dados inválidos", http.StatusBadRequest)
			return
		}

		// Garante um ID único e o registro da hora certa
		entry.ID = primitive.NewObjectID().Hex()
		if entry.Timestamp.IsZero() {
			entry.Timestamp = time.Now()
		}

		logCollection.InsertOne(ctx, entry)
		w.WriteHeader(http.StatusCreated)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func dashboardSummaryHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	totalActive, _ := loanCollection.CountDocuments(ctx, bson.M{"status": bson.M{"$ne": "Pago"}})
	totalClients, _ := clientCollection.CountDocuments(ctx, bson.M{})
	json.NewEncoder(w).Encode(map[string]interface{}{"totalActive": totalActive, "clientsRegistered": totalClients})
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

// --- WhatsApp Controller e Service (Mantendo Original) ---

type CreateInstance struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

type InstanceData struct {
	InstanceName string `json:"instanceName"`
	InstanceID   string `json:"instanceId"`
	Status       string `json:"status"`
	ApiKey       string `json:"apikey"`
}

type InstanceResponse struct {
	Instance InstanceData `json:"instance"`
}

type WhatsappController struct{ svc WhatsappService }

func NewWhatsappController(s WhatsappService) *WhatsappController { return &WhatsappController{svc: s} }

func (ctrl *WhatsappController) EnviarMensagem(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserConectado  string  `json:"userConectado"`
		Phone          string  `json:"phone"`
		Message        string  `json:"message"`
		Delay          int     `json:"delay"`
		Name           string  `json:"name"`
		LateDays       int     `json:"lateDays"`
		UpdatedAmount  float64 `json:"updatedAmount"`
		DateVencimento string  `json:"dateVencimento"`
		ApiKey         string  `json:"apiKey"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	ctrl.svc.SendMessage(r.Context(), body.UserConectado, body.Phone, body.Message, body.Delay, body.Name, body.LateDays, body.UpdatedAmount, body.DateVencimento, body.ApiKey)
	w.WriteHeader(200)
}

func (ctrl *WhatsappController) VerInstancias(w http.ResponseWriter, r *http.Request) {
	res, _ := ctrl.svc.ViewInstances(r.Context())
	json.NewEncoder(w).Encode(res)
}

func (ctrl *WhatsappController) CriarInstanciaMsg(w http.ResponseWriter, r *http.Request) {
	var body CreateInstance
	json.NewDecoder(r.Body).Decode(&body)
	instance, _ := ctrl.svc.CreateInstance(r.Context(), body.Name, body.Phone)
	json.NewEncoder(w).Encode(instance)
}

func (ctrl *WhatsappController) ConectarInstancia(w http.ResponseWriter, r *http.Request) {
	var body CreateInstance
	json.NewDecoder(r.Body).Decode(&body)
	res, _ := ctrl.svc.ConnectInstance(r.Context(), body.Name, body.Phone)
	json.NewEncoder(w).Encode(res)
}

func (ctrl *WhatsappController) DesconectarInstancia(w http.ResponseWriter, r *http.Request) {
	var body CreateInstance
	json.NewDecoder(r.Body).Decode(&body)
	ctrl.svc.DisconnectInstance(r.Context(), body.Name)
	w.WriteHeader(200)
}

type WhatsappService interface {
	SendMessage(ctx context.Context, inst, phone, msg string, delay int, name string, days int, amt float64, due, key string) error
	ViewInstances(ctx context.Context) ([]InstanceResponse, error)
	CreateInstance(ctx context.Context, name, phone string) (interface{}, error)
	ConnectInstance(ctx context.Context, name, phone string) (interface{}, error)
	DisconnectInstance(ctx context.Context, name string) error
}

type whatsappService struct{ ApiURL, ApiToken, ApiGlobalKey string }

func NewWhatsappService() WhatsappService {
	return &whatsappService{ApiURL: "http://34.69.98.196:8080", ApiToken: "5E603D2122C0-42C5-AFAD-FE1E8C0A3791", ApiGlobalKey: "VIDSFZs6I3FlZtnsbUoK"}
}

func (s *whatsappService) SendMessage(ctx context.Context, userConectado string, phone string, message string, delayLevel int, name string, lateDays int, updatedAmount float64, dateVencimento string, apiKey string) error {
	message = DefinirMensagemComDetalhes(delayLevel, name, lateDays, updatedAmount, dateVencimento)
	re := regexp.MustCompile(`\D`)
	phoneLimpo := re.ReplaceAllString(phone, "")
	if len(phoneLimpo) < 13 && len(phoneLimpo) >= 10 {
		phoneLimpo = "55" + phoneLimpo
	}

	url := fmt.Sprintf("%s/message/sendText/%s", s.ApiURL, userConectado)
	payload := map[string]interface{}{
		"number":      phoneLimpo,
		"options":     map[string]interface{}{"delay": 1200, "presence": "composing"},
		"textMessage": map[string]string{"text": message},
	}
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", apiKey)
	client := &http.Client{Timeout: 10 * time.Second}
	client.Do(req)
	return nil
}

func DefinirMensagemComDetalhes(delayLevel int, name string, lateDays int, updatedAmount float64, dateVencimento string) string {
	valorFormatado := fmt.Sprintf("R$ %.2f", updatedAmount)
	switch delayLevel {
	case 1:
		return fmt.Sprintf("Olá, *%s*! Notamos que o seu pagamento ainda não consta no sistema.\n• Valor: %s\n• Atraso: %d dia(s)", name, valorFormatado, lateDays)
	case 2:
		return fmt.Sprintf("Olá, *%s*! Passando para lembrar do vencimento da sua parcela no valor de *%s* no dia %s.", name, valorFormatado, dateVencimento)
	case 3:
		return fmt.Sprintf("🚨 NOTIFICAÇÃO URGENTE - %s, o débito de %s está em fase avançada de atraso (%d dias).", name, valorFormatado, lateDays)
	default:
		return "Olá! Identificamos uma pendência em seu cadastro na Credit Now."
	}
}

func (s *whatsappService) ViewInstances(ctx context.Context) ([]InstanceResponse, error) {
	url := s.ApiURL + "/instance/fetchInstances"
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("apikey", s.ApiGlobalKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var res []InstanceResponse
	json.NewDecoder(resp.Body).Decode(&res)
	return res, nil
}

func (s *whatsappService) CreateInstance(ctx context.Context, name, phone string) (interface{}, error) {
	url := s.ApiURL + "/instance/create"
	payload := map[string]interface{}{"instanceName": name, "qrcode": true, "phone": phone}
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", s.ApiGlobalKey)
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var res interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res, nil
}

func (s *whatsappService) ConnectInstance(ctx context.Context, name, phone string) (interface{}, error) {
	re := regexp.MustCompile(`\D`)
	phoneLimpo := re.ReplaceAllString(phone, "")
	if len(phoneLimpo) < 13 && len(phoneLimpo) >= 10 {
		phoneLimpo = "55" + phoneLimpo
	}
	url := fmt.Sprintf("%s/instance/connect/%s?number=%s", s.ApiURL, name, phoneLimpo)
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("apikey", s.ApiGlobalKey)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var res interface{}
	json.NewDecoder(resp.Body).Decode(&res)
	return res, nil
}

func (s *whatsappService) DisconnectInstance(ctx context.Context, name string) error {
	url := fmt.Sprintf("%s/instance/logout/%s", s.ApiURL, name)
	req, err := http.NewRequestWithContext(ctx, "DELETE", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", s.ApiGlobalKey)
	client := &http.Client{Timeout: 10 * time.Second}
	client.Do(req)
	return nil
}
