"""Health checks."""

from fastapi import APIRouter
from datetime import datetime

router = APIRouter(prefix="/health", tags=["health"])

@router.get("")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat(), "version": "0.1.0"}

@router.get("/ready")
def ready():
    return {"status": "ready"}
