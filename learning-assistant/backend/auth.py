import hmac
import os
import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import StudentProfile, User
from security import create_access_token, decode_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=255)
    password: str = Field(min_length=8, max_length=128)
    instructor_code: str | None = None


@router.post("/register", status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already registered.")

    role = "student"
    if body.instructor_code:
        expected = os.getenv("INSTRUCTOR_CODE", "")
        if expected and hmac.compare_digest(body.instructor_code, expected):
            role = "instructor"
        else:
            raise HTTPException(status_code=403, detail="Invalid instructor code.")

    user = User(
        name=body.name.strip(),
        email=email,
        password_hash=hash_password(body.password),
        role=role,
    )
    db.add(user)
    db.flush()  # assigns user.id so the profile row can reference it

    if role == "student":
        db.add(StudentProfile(user_id=user.id))  # 1:1 profile, filled in later by Module 1

    db.commit()
    return {"id": str(user.id), "name": user.name, "email": user.email, "role": user.role}


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """The form's 'username' field is the user's email."""
    user = db.scalar(select(User).where(User.email == form.username.strip().lower()))
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(str(user.id), user.role)
    return {"access_token": token, "token_type": "bearer", "role": user.role, "name": user.name}


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(
        status_code=401,
        detail="Invalid or expired token.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise credentials_error

    user = db.get(User, user_id)
    if user is None:
        raise credentials_error
    return user


def require_instructor(user: User = Depends(get_current_user)) -> User:
    if user.role != "instructor":
        raise HTTPException(status_code=403, detail="Instructor access required.")
    return user


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": str(user.id), "name": user.name, "email": user.email, "role": user.role}