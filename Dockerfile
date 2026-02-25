# Use the official Golang image to create a build artifact.
# This is based on Debian and sets the GOPATH to /go.
# https://hub.docker.com/_/golang
FROM golang:1.25.6-alpine as builder

# Create and change to the app directory.
WORKDIR /app

# Retrieve application dependencies using go modules.
# Allows container builds to reuse downloaded dependencies.
COPY go.mod ./
COPY go.sum ./

RUN go mod download

# Copy local code to the container image.
COPY backend ./

# Build the binary.
# -mod=readonly ensures immutable go.mod and go.sum in container builds.
RUN CGO_ENABLED=0 GOOS=linux go build -mod=readonly -v -o webapp ./cmd/main.go

# Use the official Alpine image for a lean production container.
# https://hub.docker.com/_/alpine
# https://docs.docker.com/develop/develop-images/multistage-build/#use-multi-stage-builds
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags='-w -s -extldflags "-static"' \
    -mod=readonly -v -o webapp ./cmd/main.go

FROM alpine:latest

# Instala ca-certificates e tzdata para timezone
RUN apk --no-cache add ca-certificates tzdata

# Define timezone para America/Sao_Paulo
ENV TZ=America/Sao_Paulo

WORKDIR /app
COPY --from=builder /app/webapp /webapp
EXPOSE 8080
USER 65534:65534
ENTRYPOINT ["/webapp"]