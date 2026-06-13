# -*- coding: utf-8 -*-
"""Authentication module — JWT, admin verify, employee token verify."""
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Request, status

JWT_SECRET = os.getenv("JWT_SECRET", "agentscope-cloud-agents-secret-key")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")


@dataclass
class AuthUser:
    user_id: str
    role: str  # "admin" | "user"
    admin_user_id: str
    name: str = ""


def create_jwt(user_id: str, role: str, admin_user_id: str, name: str = "") -> str:
    payload = {
        "user_id": user_id,
        "role": role,
        "admin_user_id": admin_user_id,
        "name": name,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
        )


def verify_admin(username: str, password: str) -> bool:
    if not ADMIN_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_PASSWORD not configured.",
        )
    return username == ADMIN_USERNAME and password == ADMIN_PASSWORD


def generate_employee_token() -> str:
    return secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


async def get_current_user(request: Request) -> AuthUser:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header required.",
        )
    token = auth_header[7:]
    payload = decode_jwt(token)
    return AuthUser(
        user_id=payload["user_id"],
        role=payload["role"],
        admin_user_id=payload["admin_user_id"],
        name=payload.get("name", ""),
    )


def require_admin(auth_user: AuthUser) -> None:
    if auth_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
