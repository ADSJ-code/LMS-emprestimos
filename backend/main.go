package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
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
	// 🚀 NOVOS CAMPOS: Configuração NF-e (Focus NFe)
	IbgeCode         string `json:"ibgeCode" bson:"ibgeCode"`
	Im               string `json:"im" bson:"im"`
	FocusNfeToken    string `json:"focusNfeToken" bson:"focusNfeToken"`
	ItemListaServico string `json:"itemListaServico" bson:"itemListaServico"`
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
	ChecklistAtApproval []string        `json:"checklistAtApproval" bson:"checklistAtApproval"` // FIX: Removido omitempty
	TotalPaidInterest   float64         `json:"totalPaidInterest" bson:"totalPaidInterest"`
	TotalPaidCapital    float64         `json:"totalPaidCapital" bson:"totalPaidCapital"`
	History             []PaymentRecord `json:"history" bson:"history"` // FIX: Removido omitempty
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
	MultiDates          []MultiDate     `json:"multiDates" bson:"multiDates"` // FIX: Removido omitempty
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
	Block        string      `json:"block,omitempty" bson:"block,omitempty"` // 🚀 ADICIONADO
	Floor        string      `json:"floor,omitempty" bson:"floor,omitempty"` // 🚀 ADICIONADO
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

// 🚀 NOVA ESTRUTURA: Modelo da Nota Fiscal
type InvoiceRecord struct {
	ID           string    `json:"id" bson:"_id,omitempty"`
	Client       string    `json:"client" bson:"client"`
	CPF          string    `json:"cpf" bson:"cpf"`
	ServiceValue float64   `json:"serviceValue" bson:"serviceValue"`
	IssueDate    time.Time `json:"issueDate" bson:"issueDate"`
	Status       string    `json:"status" bson:"status"`
	PdfUrl       string    `json:"pdfUrl,omitempty" bson:"pdfUrl,omitempty"`
	ErrorMsg     string    `json:"errorMsg,omitempty" bson:"errorMsg,omitempty"`
}

// 🚀 NOVA ESTRUTURA: Modelo de Fluxo de Caixa (Caixa Interno)
type CashFlowEntry struct {
	ID          string    `json:"id" bson:"_id,omitempty"`
	Type        string    `json:"type" bson:"type"`             // "ENTRADA" ou "SAIDA"
	Category    string    `json:"category" bson:"category"`     // "Parcela", "Empréstimo", "Despesa", "Aporte"
	Description string    `json:"description" bson:"description"`
	Amount      float64   `json:"amount" bson:"amount"`
	Date        time.Time `json:"date" bson:"date"`
	ReferenceID string    `json:"referenceId,omitempty" bson:"referenceId,omitempty"` // ID do contrato ligado
	Status      string    `json:"status" bson:"status"`         // "Efetivado", "Pendente"
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
	invoiceCollection   *mongo.Collection
	cashFlowCollection  *mongo.Collection // 🚀 NOVA COLEÇÃO FLUXO DE CAIXA
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
	invoiceCollection = db.Collection("invoices")
	cashFlowCollection = db.Collection("cashflow") // 🚀 CONECTA A NOVA COLEÇÃO CAIXA
	log.Println("✅ MongoDB Conectado ao CreditNow!")

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

	// 🚀 NOVAS ROTAS: Fluxo de Caixa
	mux.HandleFunc("/api/cashflow", authMiddleware(cashFlowHandler))
	mux.HandleFunc("/api/cashflow/", authMiddleware(cashFlowHandler)) // 🚀 ROTA COM A BARRA PARA ACEITAR O ID NA EXCLUSÃO

	// 🚀 NOVAS ROTAS: Notas Fiscais
    mux.HandleFunc("/api/invoices", authMiddleware(invoicesHandler))
    mux.HandleFunc("/api/invoices/emit", authMiddleware(invoiceEmitHandler))
    mux.HandleFunc("/api/invoices/webhook", webhookInvoiceHandler) // Webhook livre de Auth
    mux.HandleFunc("/api/invoices/", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
        // Se a URL terminar com /cancel, direciona para o cancelamento na Sefaz
        if strings.HasSuffix(r.URL.Path, "/cancel") {
            invoiceCancelHandler(w, r)
            return
        }
        // Exclusão normal da fila
        invoiceDeleteHandler(w, r)
    }))

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

	// 🚀 PROMOÇÃO VIP: Força o utilizador André a ser ADMIN toda a vez que o servidor liga
	userCollection.UpdateOne(ctx, bson.M{"ANDRE SISTEMA": "andreduarteaj@outlook.com"}, bson.M{"$set": bson.M{"role": "ADMIN"}})
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
		bodyBytes, _ := io.ReadAll(r.Body)

		var l Loan
		json.Unmarshal(bodyBytes, &l)

		// 🚨 TRAVA DE SEGURANÇA: Impede contratos para clientes bloqueados (Lista Negra)
		if l.Client != "" {
			var client Client
			err := clientCollection.FindOne(ctx, bson.M{"name": l.Client}).Decode(&client)
			if err == nil && client.Status == "Bloqueado" {
				http.Error(w, "Cliente encontra-se bloqueado (Lista Negra). Criação de contrato proibida.", http.StatusForbidden)
				return
			}
		}

		// --- FIX: Trava de Arredondamento para evitar dízimas no banco ---
		l.InstallmentValue = math.Round(l.InstallmentValue*100) / 100
		l.Amount = math.Round(l.Amount*100) / 100

		var raw map[string]interface{}
		json.Unmarshal(bodyBytes, &raw)
		if customID, ok := raw["id"].(string); ok && customID != "" {
			l.ID = customID
		}

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
			l.ID = fmt.Sprintf("%04d", nextNum)
		}

		loanCollection.InsertOne(ctx, l)

		// 🚀 AUTOMAÇÃO DO CAIXA: Registra a saída do dinheiro do empréstimo automaticamente
		cf := CashFlowEntry{
			ID:          fmt.Sprintf("CF-%d", time.Now().UnixNano()/1e6),
			Type:        "SAIDA",
			Category:    "Empréstimo Liberado",
			Description: fmt.Sprintf("Empréstimo concedido a %s", l.Client),
			Amount:      l.Amount,
			Date:        time.Now(),
			ReferenceID: l.ID,
			Status:      "Efetivado",
		}
		cashFlowCollection.InsertOne(ctx, cf)

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

		// --- FIX: Trava de Arredondamento para evitar dízimas no banco ---
		l.InstallmentValue = math.Round(l.InstallmentValue*100) / 100
		l.Amount = math.Round(l.Amount*100) / 100

		// 🚀 AUTOMAÇÃO DO CAIXA: Compara o histórico antigo com o novo para achar a Baixa da Parcela
		var oldLoan Loan
		if err := loanCollection.FindOne(ctx, bson.M{"id": id}).Decode(&oldLoan); err == nil {
			if len(l.History) > len(oldLoan.History) {
				// 🟢 Descobriu que tem pagamento(s) novo(s)! (BAIXA)
				for i := len(oldLoan.History); i < len(l.History); i++ {
					payment := l.History[i]
					if payment.Amount > 0 {
						cf := CashFlowEntry{
							ID:          fmt.Sprintf("CF-%d", time.Now().UnixNano()/1e6 + int64(i)),
							Type:        "ENTRADA",
							Category:    "Recebimento de Parcela",
							Description: fmt.Sprintf("Pagamento (%s) - %s", payment.Type, l.Client),
							Amount:      payment.Amount,
							Date:        time.Now(),
							ReferenceID: l.ID,
							Status:      "Efetivado",
						}
						cashFlowCollection.InsertOne(ctx, cf)
					}
				}
			} else if len(l.History) < len(oldLoan.History) {
				// 🔴 Descobriu que um pagamento foi removido! (DESFAZER BAIXA)
				for i := len(l.History); i < len(oldLoan.History); i++ {
					removedPayment := oldLoan.History[i]
					if removedPayment.Amount > 0 {
						cf := CashFlowEntry{
							ID:          fmt.Sprintf("CF-%d", time.Now().UnixNano()/1e6 + int64(i)),
							Type:        "SAIDA", // Lança uma saída para anular a entrada
							Category:    "Estorno de Parcela",
							Description: fmt.Sprintf("Estorno de Pagamento (%s) - %s", removedPayment.Type, l.Client),
							Amount:      removedPayment.Amount,
							Date:        time.Now(),
							ReferenceID: l.ID,
							Status:      "Efetivado",
						}
						cashFlowCollection.InsertOne(ctx, cf)
					}
				}
			}
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

		// 🚨 TRAVA DE DUPLICIDADE: Verifica se o CPF/CNPJ já existe
		if c.CPF != "" {
			var existingClient Client
			err := clientCollection.FindOne(ctx, bson.M{"cpf": c.CPF}).Decode(&existingClient)
			if err == nil {
				http.Error(w, "Já existe um cliente cadastrado com este CPF/CNPJ.", http.StatusConflict)
				return
			}

			// 🚨 TRAVA LISTA NEGRA: Verifica se está banido
			var blacklisted BlacklistEntry
			err = blacklistCollection.FindOne(ctx, bson.M{"cpf": c.CPF}).Decode(&blacklisted)
			if err == nil {
				http.Error(w, "Este CPF/CNPJ está na Lista Negra. É preciso removê-lo de lá antes de cadastrar.", http.StatusForbidden)
				return
			}
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
	id, _ := strconv.ParseInt(idStr, 10, 64)

	switch r.Method {
	case http.MethodPut:
		var c Client
		json.NewDecoder(r.Body).Decode(&c)

		// 🚨 TRAVA DE DUPLICIDADE (EDIÇÃO): Verifica se o novo CPF pertence a outro cliente
		if c.CPF != "" {
			var existingClient Client
			err := clientCollection.FindOne(ctx, bson.M{"cpf": c.CPF, "id": bson.M{"$ne": id}}).Decode(&existingClient)
			if err == nil {
				http.Error(w, "Já existe OUTRO cliente cadastrado com este CPF/CNPJ.", http.StatusConflict)
				return
			}
		}

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
	case http.MethodPost:
		var entry BlacklistEntry
		json.NewDecoder(r.Body).Decode(&entry)

		entry.ID = primitive.NewObjectID().Hex()
		if entry.Date == "" {
			entry.Date = time.Now().Format("2006-01-02")
		}

		// Insere na lista negra
		blacklistCollection.InsertOne(ctx, entry)

		// Bloqueia o cliente na coleção principal, impedindo que atue
		if entry.CPF != "" {
			clientCollection.UpdateOne(ctx, bson.M{"cpf": entry.CPF}, bson.M{"$set": bson.M{"status": "Bloqueado"}})
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(entry)
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
		// 🚀 CORREÇÃO DO ERRO 405: A API agora aceita Edições (PUT) na Lista Negra
		var entry BlacklistEntry
		if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
			http.Error(w, "Dados inválidos", http.StatusBadRequest)
			return
		}
		entry.ID = id // Garante que o ID não se perde

		// Atualiza os dados na lista negra
		blacklistCollection.ReplaceOne(ctx, bson.M{"id": id}, entry)

		// Se houver um CPF na edição, garante o bloqueio do cliente na base principal
		if entry.CPF != "" {
			clientCollection.UpdateOne(ctx, bson.M{"cpf": entry.CPF}, bson.M{"$set": bson.M{"status": "Bloqueado"}})
		}

		json.NewEncoder(w).Encode(entry)

	case http.MethodDelete:
		// 1. Busca quem é o cliente para pegar o CPF
		var entry BlacklistEntry
		err := blacklistCollection.FindOne(ctx, bson.M{"id": id}).Decode(&entry)

		// 2. Se achar, destranca o cliente na coleção principal
		if err == nil && entry.CPF != "" {
			clientCollection.UpdateOne(ctx, bson.M{"cpf": entry.CPF}, bson.M{"$set": bson.M{"status": "Ativo"}})
		}

		// 3. Remove da lista negra
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
		cursor, _ := logCollection.Find(ctx, bson.M{})
		var res []LogEntry
		cursor.All(ctx, &res)
		if res == nil {
			res = []LogEntry{}
		}
		json.NewEncoder(w).Encode(res)

	case http.MethodPost:
		var entry LogEntry
		if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
			http.Error(w, "Dados inválidos", http.StatusBadRequest)
			return
		}

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
	// 🚀 EXCLUI DA CONTAGEM DA BASE OS CLIENTES BLOQUEADOS (LISTA NEGRA)
	totalClients, _ := clientCollection.CountDocuments(ctx, bson.M{"status": bson.M{"$ne": "Bloqueado"}})
	json.NewEncoder(w).Encode(map[string]interface{}{"totalActive": totalActive, "clientsRegistered": totalClients})
}

// 🚀 HANDLER: Retorna todas as notas emitidas
func invoicesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Ordena das mais recentes para as mais antigas
	opts := options.Find().SetSort(bson.D{{Key: "issueDate", Value: -1}})
	cursor, err := invoiceCollection.Find(ctx, bson.M{}, opts)
	if err != nil {
		json.NewEncoder(w).Encode([]InvoiceRecord{})
		return
	}

	var results []InvoiceRecord
	cursor.All(ctx, &results)
	if results == nil {
		results = []InvoiceRecord{}
	}
	json.NewEncoder(w).Encode(results)
}

// 🚀 HANDLER: Exclui uma nota fiscal fisicamente do banco de dados (Hard Delete / Ignorar)
func invoiceDeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/invoices/")
	if id == "" || id == "/api/invoices/" {
		http.Error(w, "ID da nota não fornecido", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := invoiceCollection.DeleteOne(ctx, bson.M{"_id": id})
	if err != nil {
		http.Error(w, "Erro ao excluir nota fiscal", http.StatusInternalServerError)
		return
	}

	if result.DeletedCount == 0 {
		http.Error(w, "Nota fiscal não encontrada", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type CancelRequest struct {
	Justificativa string `json:"justificativa"`
}

// 🚀 HANDLER REAL: Cancela a nota fiscal diretamente na Focus NFe e na Prefeitura
func invoiceCancelHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/api/invoices/")
	id = strings.TrimSuffix(id, "/cancel")

	var req CancelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Justificativa) < 15 {
		http.Error(w, `{"mensagem": "Justificativa obrigatória (mínimo de 15 caracteres)"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var s Settings
	settingsCollection.FindOne(ctx, bson.M{}).Decode(&s)
	tokenFocus := strings.TrimSpace(s.Company.FocusNfeToken)

	apiURL := fmt.Sprintf("https://api.focusnfe.com.br/v2/nfse/%s", id)
	payloadBytes, _ := json.Marshal(req)

	client := &http.Client{}
	reqFocus, _ := http.NewRequest(http.MethodDelete, apiURL, bytes.NewBuffer(payloadBytes))
	reqFocus.SetBasicAuth(tokenFocus, "")
	reqFocus.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(reqFocus)
	
	// 🚀 AUTO-ROUTING: Tenta homologação se der 401
	if err == nil && resp.StatusCode == 401 {
		resp.Body.Close()
		apiURL = fmt.Sprintf("https://homologacao.focusnfe.com.br/v2/nfse/%s", id)
		reqFocus, _ = http.NewRequest(http.MethodDelete, apiURL, bytes.NewBuffer(payloadBytes))
		reqFocus.SetBasicAuth(tokenFocus, "")
		reqFocus.Header.Set("Content-Type", "application/json")
		resp, err = client.Do(reqFocus)
		log.Println("🔄 [AUTO-ROUTING CANCELAMENTO] Redirecionado para Homologação.")
	}

	if err != nil {
		http.Error(w, `{"mensagem": "Falha ao se comunicar com o gateway fiscal"}`, http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusAccepted {
		invoiceCollection.UpdateOne(ctx, bson.M{"_id": id}, bson.M{"$set": bson.M{"status": "CANCELADA"}})
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"mensagem": "Nota cancelada com sucesso"}`))
	} else {
		var focusErr map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&focusErr)
		w.WriteHeader(resp.StatusCode)
		json.NewEncoder(w).Encode(focusErr)
	}
}

// 🚀 HANDLER REAL: Emite a nota fiscal via Focus NFe (Customizado ABPC SP)
func invoiceEmitHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var inv InvoiceRecord
	if err := json.NewDecoder(r.Body).Decode(&inv); err != nil {
		http.Error(w, "Dados inválidos", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var client Client
	err := clientCollection.FindOne(ctx, bson.M{"cpf": inv.CPF}).Decode(&client)
	if err != nil {
		client.Name = inv.Client
		client.CPF = inv.CPF
	}

	if inv.ID == "" {
		inv.ID = fmt.Sprintf("NF-%d", time.Now().UnixMilli()%100000)
	}

	// HIGIENIZAÇÃO DA REFERÊNCIA
	inv.ID = strings.ReplaceAll(inv.ID, ".", "")
	inv.ID = strings.ReplaceAll(inv.ID, "/", "")
	inv.ID = strings.ReplaceAll(inv.ID, " ", "")

	var existing InvoiceRecord
	errDoc := invoiceCollection.FindOne(ctx, bson.M{"_id": inv.ID}).Decode(&existing)
	if errDoc == nil && (existing.Status == "AUTORIZADA" || existing.Status == "PROCESSANDO") {
		http.Error(w, `{"mensagem": "Já existe uma nota emitida ou em processamento para esta parcela."}`, http.StatusConflict)
		return
	}

	inv.IssueDate = time.Now()
	inv.Status = "PROCESSANDO"

	opts := options.Replace().SetUpsert(true)
	_, err = invoiceCollection.ReplaceOne(ctx, bson.M{"_id": inv.ID}, inv, opts)
	if err != nil {
		http.Error(w, `{"mensagem": "Erro ao salvar solicitação de nota"}`, http.StatusInternalServerError)
		return
	}

	var s Settings
	settingsCollection.FindOne(ctx, bson.M{}).Decode(&s)

	go func(invoiceID string, c Client, serviceValue float64, comp CompanySettings) {
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer bgCancel()

		apiKey := strings.TrimSpace(comp.FocusNfeToken)
		if apiKey == "" {
			log.Println("❌ [ERRO] O Token da Focus NFe está VAZIO no banco de dados!")
			invoiceCollection.UpdateOne(bgCtx, bson.M{"_id": invoiceID}, bson.M{"$set": bson.M{"status": "ERRO", "errorMsg": "Token VAZIO no painel."}})
			return
		}

		cnpjPrestador := comp.CNPJ
		imPrestador := comp.Im
		ibgePrestador := comp.IbgeCode
		itemServico := comp.ItemListaServico

		if cnpjPrestador == "" || imPrestador == "" || ibgePrestador == "" {
			invoiceCollection.UpdateOne(bgCtx, bson.M{"_id": invoiceID}, bson.M{"$set": bson.M{"status": "ERRO", "errorMsg": "CNPJ, Inscrição Municipal ou IBGE ausentes."}})
			return
		}

		if itemServico == "" { itemServico = "15.08" }

		docLimpo := regexp.MustCompile(`\D`).ReplaceAllString(c.CPF, "")
		campoDoc := "cnpj"
		if len(docLimpo) == 11 {
			campoDoc = "cpf"
		}

		enderecoTomador := map[string]interface{}{
			"logradouro": c.Address,
			"numero":     c.Number,
			"bairro":     c.Neighborhood,
			"cep":        regexp.MustCompile(`\D`).ReplaceAllString(c.CEP, ""),
			"uf":         c.State,
		}

		cepLimpo := regexp.MustCompile(`\D`).ReplaceAllString(c.CEP, "")
		if len(cepLimpo) == 8 {
			respViaCep, err := http.Get("https://viacep.com.br/ws/" + cepLimpo + "/json/")
			if err == nil {
				defer respViaCep.Body.Close()
				var vcData struct { Ibge string `json:"ibge"` }
				if json.NewDecoder(respViaCep.Body).Decode(&vcData) == nil && vcData.Ibge != "" {
					enderecoTomador["codigo_municipio"] = vcData.Ibge
				}
			}
		}

		docPrestadorLimpo := regexp.MustCompile(`\D`).ReplaceAllString(cnpjPrestador, "")
		imPrestadorLimpo := regexp.MustCompile(`\D`).ReplaceAllString(imPrestador, "")
		ibgePrestadorLimpo := regexp.MustCompile(`\D`).ReplaceAllString(ibgePrestador, "")

		// 🚀 TIPAGEM EXATA DO OPENAPI
		payload := map[string]interface{}{
			"data_emissao":             time.Now().Format(time.RFC3339),
			"natureza_operacao":        "1",
			"optante_simples_nacional": false,
			"prestador": map[string]interface{}{
				"cnpj":                docPrestadorLimpo,
				"inscricao_municipal": imPrestadorLimpo,
				"codigo_municipio":    ibgePrestadorLimpo,
			},
			"tomador": map[string]interface{}{
				campoDoc:       docLimpo,
				"razao_social": c.Name,
				"email":        c.Email,
				"endereco":     enderecoTomador,
			},
			"servico": map[string]interface{}{
				"discriminacao":               "Nota emitida correspondente ao rendimento de gestão e intermediação financeira.",
				"item_lista_servico":          itemServico,
				"valor_servicos":              serviceValue,
				"aliquota":                    5.0,
				"codigo_tributario_municipio": "692060100",
				"iss_retido":                  false,
				"codigo_municipio":            ibgePrestadorLimpo,
			},
		}

		payloadBytes, _ := json.Marshal(payload)
		log.Printf("🔍 [FOCUS NFE] Disparando nota %s. Token lido: %s... (Tamanho: %d)", invoiceID, apiKey[:4], len(apiKey))

		apiURL := "https://api.focusnfe.com.br/v2/nfse?ref=" + invoiceID
		req, _ := http.NewRequest("POST", apiURL, bytes.NewBuffer(payloadBytes))
		req.Header.Set("Content-Type", "application/json")
		req.SetBasicAuth(apiKey, "")

		clientHttp := &http.Client{Timeout: 15 * time.Second}
		resp, err := clientHttp.Do(req)

		if err != nil {
			invoiceCollection.UpdateOne(bgCtx, bson.M{"_id": invoiceID}, bson.M{"$set": bson.M{"status": "ERRO", "errorMsg": "Falha na rede."}})
			return
		}
		
		bodyProducao, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		// 🚀 AUTO-ROUTING COM CAPTURA DE ERRO REAL
		if resp.StatusCode == 401 {
			apiURL = "https://homologacao.focusnfe.com.br/v2/nfse?ref=" + invoiceID
			req, _ = http.NewRequest("POST", apiURL, bytes.NewBuffer(payloadBytes))
			req.Header.Set("Content-Type", "application/json")
			req.SetBasicAuth(apiKey, "")

			resp, err = clientHttp.Do(req)
			if err != nil { return }

			bodyHomolog, _ := io.ReadAll(resp.Body)
			resp.Body.Close()

			if resp.StatusCode >= 400 {
				var focusErr map[string]interface{}
				json.Unmarshal(bodyHomolog, &focusErr)
				errorMsg := "Erro na Sefaz de Mauá."
				if msg, ok := focusErr["mensagem"].(string); ok {
					errorMsg = msg
				} else {
					errorMsg = string(bodyHomolog)
				}
				if len(errorMsg) > 200 { errorMsg = errorMsg[:200] + "..." }
				invoiceCollection.UpdateOne(bgCtx, bson.M{"_id": invoiceID}, bson.M{"$set": bson.M{"status": "ERRO", "errorMsg": errorMsg}})
				log.Printf("❌ Homologação falhou: %s", errorMsg)
				return
			}
			log.Println("✅ [AUTO-ROUTING] Sucesso na Homologação!")
		} else if resp.StatusCode >= 400 {
			var focusErr map[string]interface{}
			json.Unmarshal(bodyProducao, &focusErr)
			errorMsg := "Erro na Sefaz de Produção."
			if msg, ok := focusErr["mensagem"].(string); ok {
				errorMsg = msg
			} else {
				errorMsg = string(bodyProducao)
			}
			if len(errorMsg) > 200 { errorMsg = errorMsg[:200] + "..." }
			invoiceCollection.UpdateOne(bgCtx, bson.M{"_id": invoiceID}, bson.M{"$set": bson.M{"status": "ERRO", "errorMsg": errorMsg}})
			log.Printf("❌ Produção falhou: %s", errorMsg)
			return
		} else {
			log.Println("✅ Sucesso em Produção!")
		}
	}(inv.ID, client, inv.ServiceValue, s.Company)

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(inv)
}

// 🚀 WEBHOOK REAL: Escuta a resposta final da Focus NFe (Autorizada ou Erro)
func webhookInvoiceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var webhookData map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&webhookData); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	ref, okRef := webhookData["ref"].(string)
	statusGateway, okStatus := webhookData["status"].(string)

    // Desestruturação de fallback caso a Focus envie com root 'object'
    if !okRef || !okStatus {
		if obj, ok := webhookData["object"].(map[string]interface{}); ok {
			if v, ok := obj["reference"].(string); ok { ref = v }
			if v, ok := obj["status"].(string); ok { statusGateway = v }
		}
    }

	if ref == "" || statusGateway == "" {
		w.WriteHeader(http.StatusOK) // Ignora se não houver dados, retorna 200 para a Focus NFe calar-se.
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	updateFields := bson.M{}

	switch statusGateway {
	case "autorizado":
		updateFields["status"] = "AUTORIZADA"
		if url, ok := webhookData["url"].(string); ok {
			updateFields["pdfUrl"] = url
		}
	case "erro_autorizacao", "cancelado":
		updateFields["status"] = "ERRO"
		if erros, ok := webhookData["erros"].([]interface{}); ok && len(erros) > 0 {
			if errMsg, okMap := erros[0].(map[string]interface{})["mensagem"].(string); okMap {
				updateFields["errorMsg"] = errMsg
			} else {
				updateFields["errorMsg"] = fmt.Sprintf("%v", erros[0])
			}
		}
	}

	if len(updateFields) > 0 {
		invoiceCollection.UpdateOne(ctx, bson.M{"_id": ref}, bson.M{"$set": updateFields})
		log.Printf("✅ Webhook Recebido: Nota %s processada como %s", ref, updateFields["status"])
	}
	w.WriteHeader(http.StatusOK)
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

// 🚀 HANDLER: Gestão do Fluxo de Caixa (Atualizado com DELETE)
func cashFlowHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Verifica se a URL contém um ID (ex: /api/cashflow/CF-12345)
	idParam := strings.TrimPrefix(r.URL.Path, "/api/cashflow")
	idParam = strings.TrimPrefix(idParam, "/")

	switch r.Method {
	case http.MethodGet:
		if idParam != "" {
			var entry CashFlowEntry
			err := cashFlowCollection.FindOne(ctx, bson.M{"_id": idParam}).Decode(&entry)
			if err != nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(entry)
			return
		}

		opts := options.Find().SetSort(bson.D{{Key: "date", Value: -1}})
		cursor, err := cashFlowCollection.Find(ctx, bson.M{}, opts)
		if err != nil {
			json.NewEncoder(w).Encode([]CashFlowEntry{})
			return
		}
		var results []CashFlowEntry
		cursor.All(ctx, &results)
		if results == nil {
			results = []CashFlowEntry{}
		}
		json.NewEncoder(w).Encode(results)

	case http.MethodPost:
		var entry CashFlowEntry
		if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
			http.Error(w, "Dados inválidos", http.StatusBadRequest)
			return
		}
		
		entry.ID = fmt.Sprintf("CF-%d", time.Now().UnixNano()/1e6)
		if entry.Date.IsZero() {
			entry.Date = time.Now()
		}

		entry.Amount = math.Round(entry.Amount*100) / 100

		cashFlowCollection.InsertOne(ctx, entry)
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(entry)

	case http.MethodDelete:
		// 🚀 CASO DE EXCLUSÃO ADICIONADO
		if idParam == "" {
			http.Error(w, "ID de lançamento não fornecido", http.StatusBadRequest)
			return
		}
		
		_, err := cashFlowCollection.DeleteOne(ctx, bson.M{"_id": idParam})
		if err != nil {
			http.Error(w, "Erro ao remover lançamento", http.StatusInternalServerError)
			return
		}
		
		w.WriteHeader(http.StatusNoContent)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// --- WhatsApp Controller e Service ---

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

	err := ctrl.svc.SendMessage(r.Context(), body.UserConectado, body.Phone, body.Message, body.Delay, body.Name, body.LateDays, body.UpdatedAmount, body.DateVencimento, body.ApiKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
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
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(b))
	if err != nil {
		return fmt.Errorf("falha ao criar requisição HTTP: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", apiKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Erro ao contactar Evolution API: %v", err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Evolution API recusou o envio (Status %d): %s", resp.StatusCode, string(bodyBytes))
		return fmt.Errorf("Evolution API error (%d): %s", resp.StatusCode, string(bodyBytes))
	}

	log.Printf("✅ Mensagem enviada via API para %s", phoneLimpo)
	return nil
}

func DefinirMensagemComDetalhes(delayLevel int, name string, lateDays int, updatedAmount float64, dateVencimento string) string {
	// Formatando para o padrão brasileiro de moeda (vírgula)
	valorFormatado := fmt.Sprintf("%.2f", updatedAmount)
	valorFormatado = strings.Replace(valorFormatado, ".", ",", 1)

	// Pegando apenas o primeiro nome para ficar mais amigável
	primeiroNome := strings.Split(strings.TrimSpace(name), " ")[0]
	primeiroNome = strings.ToUpper(primeiroNome)

	mensagemPadrao := fmt.Sprintf("Olá, *%s*! Tudo bem?\n\nPassando para lembrar do vencimento da sua parcela no valor de R$ %s no dia %s.\n\nQualquer dúvida, estamos à disposição!", primeiroNome, valorFormatado, dateVencimento)

	switch delayLevel {
	case 1:
		return fmt.Sprintf("Olá, *%s*!\n\nNotamos que o seu pagamento ainda não consta em nosso sistema.\n\n📌 *Detalhes:*\n• Valor: R$ %s\n• Atraso: %d dia(s)\n\nCaso já tenha efetuado o pagamento, por favor desconsidere esta mensagem.", primeiroNome, valorFormatado, lateDays)
	case 3:
		return fmt.Sprintf("🚨 *AVISO DE ATRASO*\n\n*%s*, o débito de R$ %s está em fase avançada de atraso (%d dias). Por favor, entre em contato conosco o mais breve possível para regularizarmos a situação.", primeiroNome, valorFormatado, lateDays)
	default:
		return mensagemPadrao
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

func borderEnderecoTomador(m map[string]string) map[string]interface{} {
	res := make(map[string]interface{})
	for k, v := range m {
		res[k] = v
	}
	return res
}