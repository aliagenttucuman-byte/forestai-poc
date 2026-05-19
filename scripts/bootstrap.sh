#!/bin/bash
set -e

echo "🚀 Bootstrap del proyecto Nelson"

# Copiar .env si no existe
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ .env creado desde .env.example"
fi

# Backend
echo "📝 Instalando dependencias del backend..."
cd backend
pip install -e ".[dev]"
cd ..

# Frontend
echo "🎨 Instalando dependencias del frontend..."
cd frontend
npm install
cd ..

# Pre-commit
echo "🔒 Configurando pre-commit..."
pre-commit install || echo "pre-commit no instalado, saltando"

# Docker
echo "📦 Levantando servicios con Docker..."
docker compose up --build -d

echo ""
echo "✅ Proyecto listo!"
echo "   API: http://localhost:8000/docs"
echo "   Frontend: http://localhost:8080"
echo "   Qdrant: http://localhost:6333/dashboard"
