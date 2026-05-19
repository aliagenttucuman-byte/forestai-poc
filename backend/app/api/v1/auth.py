"""Endpoints de auth."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.core.security import get_password_hash, verify_password, create_access_token
from app.schemas.auth import Token, LoginRequest
from app.schemas.user import UserCreate, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=Token)
def login(req: LoginRequest):
    # TODO: validar contra DB
    token = create_access_token({"sub": "1"})
    return {"access_token": token, "token_type": "bearer"}

@router.post("/register", response_model=UserOut)
def register(user_in: UserCreate):
    # TODO: crear en DB
    return {"id": 1, "email": user_in.email, "full_name": user_in.full_name, "is_active": True}
