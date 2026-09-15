#!/bin/bash
export JWT_SECRET="sua_chave_secreta_aqui"
export MONGO_URI="mongodb://user:password@host:port/banco"
export ADMIN_INIT_PASSWORD="senha_admin_padrao"
export EVOLUTION_API_TOKEN="seu_token_aqui"
export EVOLUTION_API_GLOBAL_KEY="sua_global_key_aqui"

go run main.go