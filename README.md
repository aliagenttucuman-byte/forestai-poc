# 🚀 Nelson Project Template

> Template base para proyectos del Equipo Nelson. Python 3.12 + React 19 + Docker + IA.

## 📁 Estructura

```
.
├── backend/              # FastAPI + Python 3.12
│   ├── app/
│   │   ├── api/v1/       # Endpoints REST
│   │   ├── core/         # Config, logging, security
│   │   ├── models/       # SQLAlchemy ORM
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── repositories/ # Repository pattern
│   │   ├── services/     # Logica de negocio
│   │   ├── tasks/        # Background jobs (Celery)
│   │   └── tests/        # Tests pytest
│   ├── alembic/          # Migraciones DB
│   └── Dockerfile
├── frontend/             # React 19 + Vite 6 + Tailwind 4
│   ├── src/
│   │   ├── api/          # Axios client
│   │   ├── components/   # UI components
│   │   ├── hooks/        # React Query hooks
│   │   ├── lib/          # Utils
│   │   ├── pages/        # Rutas
│   │   └── test/         # Tests
│   ├── e2e/              # Playwright E2E
│   └── Dockerfile
├── specs/                # OpenAPI specs
├── scripts/              # Scripts de utilidad
├── docker/               # Config extra Docker
├── docker-compose.yml
├── .github/workflows/    # CI/CD GitHub Actions
├── .env.example
└── README.md
```

## 🚀 Quick Start

```bash
# 1. Clonar y entrar
git clone <repo-url> mi-proyecto
cd mi-proyecto

# 2. Bootstrap automatico
chmod +x scripts/bootstrap.sh
./scripts/bootstrap.sh

# O manual:
cp .env.example .env
cd backend && pip install -e ".[dev]" && cd ..
cd frontend && npm install && cd ..
docker compose up --build -d
```

## 🌍 URLs

| Servicio | URL |
|----------|-----|
| API Docs (Swagger) | http://localhost:8000/docs |
| API Docs (Redoc) | http://localhost:8000/redoc |
| Frontend | http://localhost:8080 |
| Qdrant Dashboard | http://localhost:6333/dashboard |
| Health Check | http://localhost:8000/api/v1/health |

## 🛠 Stack

| Capa | Tecnologia |
|------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic |
| Frontend | React 19, TypeScript 5.7, Vite 6, Tailwind 4 |
| Base de datos | PostgreSQL 16 |
| Cache | Redis 7 |
| Vector DB | Qdrant |
| LLM (dev) | Ollama (llama3.2:3b) |
| LLM (prod) | OpenAI GPT-4o |
| Auth | JWT con python-jose |
| Tests | pytest, Vitest, Playwright |
| CI/CD | GitHub Actions |
| Deploy | Google Cloud Run |

## ⚙️ Environment Variables

Ver `.env.example` para lista completa.

```bash
# Development (Ollama local)
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2:3b

# Production (OpenAI)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

## 🧪 Testing

```bash
# Backend
cd backend
pytest -xvs

# Frontend
cd frontend
npm run test -- --run

# E2E
cd frontend
npm run test:e2e
```

## 📦 Modelos Ollama (4GB VRAM)

```bash
./scripts/setup-ollama.sh
```

| Modelo | Tamaño | Uso |
|--------|--------|-----|
| llama3.2:3b | 2.0 GB | Chat general (default) |
| qwen2.5:3b | 1.9 GB | Codigo y razonamiento |
| nomic-embed-text | 274 MB | Embeddings |
| llama3.1:8b | 4.9 GB | Modelo grande (mix CPU/GPU) |
| llava:7b | 4.7 GB | Vision / analisis imagenes |

## 🐳 Docker Compose

```bash
# Levantar todo
docker compose up --build -d

# Ver logs
docker compose logs -f backend

# Detener
docker compose down
```

Servicios incluidos:
- `backend` (FastAPI)
- `frontend` (React + nginx)
- `db` (PostgreSQL)
- `redis` (Cache + broker Celery)
- `qdrant` (Vector DB)

## 🔧 Comandos utiles

```bash
# Crear migracion
cd backend && alembic revision --autogenerate -m "descripcion"

# Aplicar migracion
cd backend && alembic upgrade head

# Lint backend
cd backend && ruff check . && mypy app

# Lint frontend
cd frontend && npm run lint
```

## 📝 License

[MIT](LICENSE)
