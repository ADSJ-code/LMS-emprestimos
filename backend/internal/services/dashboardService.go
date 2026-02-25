package services

import (
	"context"

	"github.com/Rara05/ProjetoEmprestimo-back/backend/database"
	"go.mongodb.org/mongo-driver/bson"
)

type DashboardService interface {
	GetSummary(ctx context.Context) (map[string]interface{}, error)
}

type dashboardService struct{}

func NewDashboardService() DashboardService { return &dashboardService{} }

func (s *dashboardService) GetSummary(ctx context.Context) (map[string]interface{}, error) {
	loanCol := database.MDB().Collection("loans")
	clientCol := database.MDB().Collection("clients")

	totalActive, _ := loanCol.CountDocuments(ctx, bson.M{"status": "Em Dia"})
	totalOverdue, _ := loanCol.CountDocuments(ctx, bson.M{"status": "Atrasado"})
	activeClients, _ := clientCol.CountDocuments(ctx, bson.M{"status": "Ativo"})

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

	cursor, err := loanCol.Aggregate(ctx, pipeline)
	var totalCapital float64
	if err == nil {
		var aggResults []bson.M
		if err := cursor.All(ctx, &aggResults); err == nil && len(aggResults) > 0 {
			if val, ok := aggResults[0]["totalCapital"].(float64); ok {
				totalCapital = val
			} else if valInt, ok := aggResults[0]["totalCapital"].(int64); ok {
				totalCapital = float64(valInt)
			}
		}
	}

	summary := map[string]interface{}{
		"totalActive":   totalActive,
		"totalOverdue":  totalOverdue,
		"totalCapital":  totalCapital,
		"activeClients": activeClients,
	}

	return summary, nil
}
