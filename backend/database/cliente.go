package database

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/x/mongo/driver/connstring" // Útil para extrair o DB Name
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var (
	db       *gorm.DB        // Instância Postgres
	mDB      *mongo.Database // Instância MongoDB
	mClient  *mongo.Client
	useMongo bool
	lock     sync.Mutex
)

// InitDatabase inicializa a conexão baseada no DSN fornecido
func InitDatabase(dsn string) error {
	lock.Lock()
	defer lock.Unlock()

	// Se já estiver conectado, não faz nada
	if db != nil || mDB != nil {
		return nil
	}

	if isMongoURI(dsn) {
		return connectMongo(dsn)
	}

	return connectPostgres(dsn)
}

// Auxiliar para identificar se é MongoDB
func isMongoURI(dsn string) bool {
	return strings.HasPrefix(dsn, "mongodb://") || strings.HasPrefix(dsn, "mongodb+srv://")
}

func connectMongo(dsn string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(dsn))
	if err != nil {
		return err
	}

	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return err
	}

	// Extrai o nome do banco da URI de forma segura
	cs, err := connstring.ParseAndValidate(dsn)
	if err != nil || cs.Database == "" {
		return errors.New("mongodb uri missing database name")
	}

	mClient = client
	mDB = client.Database(cs.Database)
	useMongo = true
	return nil
}

func connectPostgres(dsn string) error {
	conn, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return err
	}
	db = conn
	useMongo = false
	return nil
}

func GetMongoDB() *mongo.Database {
	return mDB
}

func GetPostgresDB() *gorm.DB {
	return db
}

func DB() *gorm.DB {
	return db
}

func MDB() *mongo.Database {
	return mDB
}

func UseMongo() bool {
	return useMongo
}
