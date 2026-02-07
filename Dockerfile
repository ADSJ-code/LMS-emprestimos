# --- ETAPA 1: FRONT-END (Node 22 para compatibilidade com Vite novo) ---
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Isso vai gerar a pasta 'backend/dist' graças à sua config do Vite
RUN npm run build

# --- ETAPA 2: BACK-END (Go) ---
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app-api

# Copia os arquivos de dependência do Go
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copia o código fonte do Go
COPY backend/*.go ./

# IMPORTANTE: Pega o site construído na Etapa 1 e joga dentro do Go
COPY --from=frontend-builder /app/backend/dist ./dist

# Compila o executável final
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

# --- ETAPA 3: IMAGEM FINAL (Leve e Pronta para Prod) ---
FROM alpine:latest
WORKDIR /root/
# Instala certificados de segurança e fuso horário
RUN apk --no-cache add ca-certificates tzdata
ENV TZ=America/Sao_Paulo

# Traz apenas o executável pronto da Etapa 2
COPY --from=backend-builder /app-api/server .

# Expõe a porta que o Render quer
EXPOSE 8080

# Comando para iniciar o servidor Go (NÃO o Vite)
CMD ["./server"]