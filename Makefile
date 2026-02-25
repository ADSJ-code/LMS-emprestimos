# ==========================================
# Variáveis de Configuração
# ==========================================
PROJECT_ID=creditnow-prod
SERVICE_NAME=creditnow-prod
REGION=us-central1
VERSION=latest
IMAGE_TAG=gcr.io/$(PROJECT_ID)/$(SERVICE_NAME):$(VERSION)

# Configurações do Cloud Run
MEMORY=512Mi
CPU=1
MAX_INSTANCES=1
MIN_INSTANCES=0
TIMEOUT=300
PORT=8080

# ==========================================
# Comandos de Desenvolvimento
# ==========================================

.PHONY: help
help: ## Mostra esta mensagem de ajuda
	@echo "Comandos disponíveis:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.PHONY: test
test: ## Executa os testes do projeto
	@echo "🧪 Executando testes..."
	go clean -cache
	go test ./... -v

.PHONY: test-coverage
test-coverage: ## Executa testes com cobertura
	@echo "🧪 Executando testes com cobertura..."
	go test ./... -coverprofile=coverage.out
	go tool cover -html=coverage.out -o coverage.html
	@echo "✅ Relatório de cobertura gerado: coverage.html"

.PHONY: lint
lint: ## Executa o linter no código
	@echo "🔍 Executando linter..."
	go vet ./...
	go fmt ./...

.PHONY: build-local
build-local: ## Compila o binário localmente
	@echo "🔨 Compilando binário local..."
	go build -o bin/server .
	@echo "✅ Binário compilado: bin/server"

.PHONY: run-local
run-local: build-local ## Executa o servidor localmente
	@echo "🚀 Iniciando servidor local..."
	./bin/server

# ==========================================
# Comandos Docker
# ==========================================

.PHONY: docker-build
docker-build: ## Cria a imagem Docker
	@echo "🐳 Criando imagem Docker..."
	docker build --platform linux/amd64 --tag $(IMAGE_TAG) .
	@echo "✅ Imagem criada: $(IMAGE_TAG)"

.PHONY: docker-run
docker-run: ## Executa o container localmente
	@echo "🐳 Executando container local..."
	docker run -p 8080:8080 --env-file .env $(IMAGE_TAG)

.PHONY: docker-stop
docker-stop: ## Para todos os containers
	@echo "🛑 Parando containers..."
	-docker stop $$(docker ps -a -q) 2>/dev/null || true
	-docker rm $$(docker ps -a -q) 2>/dev/null || true
	@echo "✅ Containers parados"

.PHONY: docker-clean
docker-clean: docker-stop ## Remove imagens e containers não utilizados
	@echo "🧹 Limpando Docker..."
	-docker system prune -f
	@echo "✅ Limpeza concluída"

# ==========================================
# Comandos Google Cloud
# ==========================================

.PHONY: gcloud-auth
gcloud-auth: ## Configura autenticação do Docker com GCP
	@echo "🔐 Configurando autenticação..."
	gcloud auth configure-docker -q
	@echo "✅ Autenticação configurada"

.PHONY: gcloud-set-project
gcloud-set-project: ## Define o projeto GCP ativo
	@echo "☁️  Configurando projeto GCP..."
	gcloud config set project $(PROJECT_ID)
	@echo "✅ Projeto configurado: $(PROJECT_ID)"

.PHONY: publish
publish: gcloud-auth ## Publica a imagem no Container Registry
	@echo "📤 Publicando imagem no GCR..."
	docker push $(IMAGE_TAG)
	@echo "✅ Imagem publicada: $(IMAGE_TAG)"

deploy-sleep:
	sleep 5

.PHONY: deploy-cloudrun
deploy-cloudrun: describe ## Faz deploy no Cloud Run (sem rebuild)
	@echo "🚀 Fazendo deploy no Cloud Run..."
	gcloud run deploy $(SERVICE_NAME) \
		--image $(IMAGE_TAG) \
		--platform managed \
		--region $(REGION) \
		--allow-unauthenticated \
		--project $(PROJECT_ID)
	@echo "✅ Deploy concluído!"
# ==========================================
# Comandos Completos
# ==========================================

.PHONY: deploy
deploy: docker-build publish deploy-sleep deploy-cloudrun ## Build completo + Deploy no Cloud Run
	@echo "🎉 Deploy completo finalizado!"

.PHONY: quick-deploy
quick-deploy: deploy-cloudrun ## Deploy rápido (usa imagem já publicada)
	@echo "⚡ Deploy rápido concluído!"

.PHONY: full-deploy
full-deploy: lint test docker-build publish deploy-cloudrun ## Lint + Test + Build + Deploy
	@echo "🎉 Deploy completo com testes finalizado!"

# ==========================================
# Comandos de Manutenção
# ==========================================

.PHONY: logs
logs: ## Visualiza logs do Cloud Run
	@echo "📋 Obtendo logs..."
	gcloud run services logs read $(SERVICE_NAME) --region $(REGION) --limit 100 --project $(PROJECT_ID)

.PHONY: logs-tail
logs-tail: ## Visualiza logs em tempo real
	@echo "📋 Monitorando logs..."
	gcloud run services logs tail $(SERVICE_NAME) --region $(REGION) --project $(PROJECT_ID)

.PHONY: describe
describe: ## Mostra informações do serviço
	@echo "ℹ️  Informações do serviço:"
	gcloud run services describe $(SERVICE_NAME) --region $(REGION) --project $(PROJECT_ID)

.PHONY: url
url: ## Mostra a URL do serviço
	@echo "🌐 URL do serviço:"
	@gcloud run services describe $(SERVICE_NAME) --region $(REGION) --format='value(status.url)' --project $(PROJECT_ID)

.PHONY: status
status: ## Mostra o status do serviço
	@echo "📊 Status do serviço:"
	@gcloud run services list --filter="metadata.name:$(SERVICE_NAME)" --region $(REGION) --project $(PROJECT_ID)

# ==========================================
# Comandos de Utilidade
# ==========================================

.PHONY: clean
clean: docker-clean ## Limpeza completa
	@echo "🧹 Limpando arquivos temporários..."
	rm -rf bin/
	rm -f coverage.out coverage.html
	@echo "✅ Limpeza completa finalizada"

.PHONY: env-example
env-example: ## Cria arquivo .env.example
	@echo "📝 Criando .env.example..."
	@echo "# Configurações da API" > .env.example
	@echo "PORT=8080" >> .env.example
	@echo "DATABASE_URL=mongodb://..." >> .env.example
	@echo "JWT_SECRET=seu-secret-aqui" >> .env.example
	@echo "✅ Arquivo .env.example criado"

# Default target
.DEFAULT_GOAL := help