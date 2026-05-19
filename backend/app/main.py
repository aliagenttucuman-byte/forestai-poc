from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.analyses import router as analyses_router
from app.db.models import Base
from app.db.session import engine

# Crear tablas al arrancar (solo PoC; en prod se usa Alembic)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="ForestAI PoC",
    description="Inventario forestal automático desde ortofotos de drones",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyses_router)

@app.get("/health")
def health():
    return {"status": "ok", "service": "forestai-backend"}
