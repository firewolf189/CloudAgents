# -*- coding: utf-8 -*-
"""Authentication for admin portal — super admin JWT."""
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Request, status

JWT_SECRET = os.getenv("JWT_SECRET", "admin-portal-secret-key")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30

SUPER_ADMIN_USERNAME = os.getenv("SUPER_ADMIN_USERNAME", "admin")
SUPER_ADMIN_PASSWORD = os.getenv("SUPER_ADMIN_PASSWORD", "")


@dataclass
class AuthUser:
    user_id: str
    role: str = "super_admin"


def create_jwt(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "role": "super_admin",
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")


def verify_admin(username: str, password: str) -> bool:
    if not SUPER_ADMIN_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPER_ADMIN_PASSWORD not configured.",
        )
    return username == SUPER_ADMIN_USERNAME and password == SUPER_ADMIN_PASSWORD


async def get_current_user(request: Request) -> AuthUser:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authorization required.")
    payload = decode_jwt(auth_header[7:])
    return AuthUser(user_id=payload["user_id"], role=payload.get("role", "super_admin"))
