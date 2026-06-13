# -*- coding: utf-8 -*-
"""Auth router — super admin login."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import (
    SUPER_ADMIN_USERNAME,
    AuthUser,
    create_jwt,
    get_current_user,
    verify_admin,
)

auth_router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user_id: str


class MeResponse(BaseModel):
    user_id: str
    role: str


@auth_router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest) -> LoginResponse:
    verify_admin(body.username, body.password)
    token = create_jwt(SUPER_ADMIN_USERNAME)
    return LoginResponse(token=token, user_id=SUPER_ADMIN_USERNAME)


@auth_router.get("/me", response_model=MeResponse)
async def me(user: AuthUser = Depends(get_current_user)) -> MeResponse:
    return MeResponse(user_id=user.user_id, role=user.role)
