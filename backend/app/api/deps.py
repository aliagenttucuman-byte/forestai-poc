"""Dependencias de FastAPI."""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.core.security import decode_token
from app.database import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token invalido")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token invalido")
    return {"id": int(user_id), "email": "user@example.com"}  # TODO: query real
