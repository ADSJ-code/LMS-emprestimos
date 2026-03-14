FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM golang:1.24-alpine AS backend-builder
WORKDIR /app-api
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/*.go ./
COPY --from=frontend-builder /app/backend/dist ./dist
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine:latest
WORKDIR /root/
RUN apk --no-cache add ca-certificates tzdata
ENV TZ=America/Sao_Paulo

COPY --from=backend-builder /app-api/server .

COPY --from=backend-builder /app-api/dist ./dist

EXPOSE 8080
CMD ["./server"]