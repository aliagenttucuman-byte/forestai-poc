"""Schemas Pydantic de User."""

from pydantic import BaseModel, EmailStr, Field

class UserBase(BaseModel):
    email: EmailStr
    full_name: str | None = None

class UserCreate(UserBase):
    password: str = Field(..., min_length=8)

class UserOut(UserBase):
    id: int
    is_active: bool

    class Config:
        from_attributes = True
