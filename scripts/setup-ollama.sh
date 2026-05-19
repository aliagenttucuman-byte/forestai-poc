#!/bin/bash
set -e

echo "🤖 Descargando modelos de Ollama recomendados..."

# Modelos para 4GB VRAM
ollama pull llama3.2:3b || echo "llama3.2:3b ya existe"
ollama pull qwen2.5:3b || echo "qwen2.5:3b ya existe"
ollama pull nomic-embed-text || echo "nomic-embed-text ya existe"

# Modelo grande disponible
ollama pull llama3.1:8b || echo "llama3.1:8b ya existe"

# Vision
ollama pull llava:7b || echo "llava:7b ya existe"

echo "✅ Modelos listos"
