# -*- coding: utf-8 -*-
"""Authentication router — login endpoints."""
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from auth import (
    ADMIN_USERNAME,
    AuthUser,
    create_jwt,
    get_current_user,
    hash_password,
    verify_admin,
    verify_password,
)

auth_router = APIRouter(prefix="/auth", tags=["auth"])

# Redis key helpers
_TOKEN_KEY = "agentscope:dept_tokens:{token}"
_USER_KEY = "agentscope:dept_users:{admin_user_id}:{user_id}"
_CRED_KEY = "agentscope:dept_credentials:{admin_user_id}:{username}"
_USERNAME_LOOKUP_KEY = "agentscope:username_lookup:{username}"


async def _get_redis(request: Request) -> Any:
    storage = request.app.state.storage
    return storage.get_client()


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class TokenLoginRequest(BaseModel):
    token: str


class SetCredentialsRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32)
    password: str = Field(..., min_length=4, max_length=128)


class LoginResponse(BaseModel):
    token: str
    role: str
    user_id: str
    name: str = ""


class MeResponse(BaseModel):
    user_id: str
    role: str
    name: str
    has_credentials: bool = False


@auth_router.post("/login", response_model=LoginResponse)
async def unified_login(
    body: AdminLoginRequest,
    redis: Any = Depends(_get_redis),
) -> LoginResponse:
    lookup_key = _USERNAME_LOOKUP_KEY.format(username=body.username)
    lookup_raw = await redis.get(lookup_key)

    if lookup_raw:
        lookup = json.loads(lookup_raw)
        admin_user_id = lookup["admin_user_id"]
        cred_key = _CRED_KEY.format(
            admin_user_id=admin_user_id, username=body.username
        )
        cred_raw = await redis.get(cred_key)
        if cred_raw:
            cred = json.loads(cred_raw)
            if verify_password(body.password, cred["password_hash"]):
                user_id = cred["user_id"]
                role = cred["role"]
                name = cred.get("name", body.username)
                jwt_token = create_jwt(
                    user_id=user_id,
                    role=role,
                    admin_user_id=admin_user_id,
                    name=name,
                )
                return LoginResponse(
                    token=jwt_token,
                    role=role,
                    user_id=user_id,
                    name=name,
                )

    # Fallback: check env-var admin credentials
    try:
        admin_ok = verify_admin(body.username, body.password)
    except HTTPException:
        admin_ok = False

    if admin_ok:
        jwt_token = create_jwt(
            user_id=ADMIN_USERNAME,
            role="admin",
            admin_user_id=ADMIN_USERNAME,
            name=ADMIN_USERNAME,
        )
        return LoginResponse(
            token=jwt_token,
            role="admin",
            user_id=ADMIN_USERNAME,
            name=ADMIN_USERNAME,
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password.",
    )


@auth_router.post("/login/token", response_model=LoginResponse)
async def token_login(
    body: TokenLoginRequest,
    redis: Any = Depends(_get_redis),
) -> LoginResponse:
    token_key = _TOKEN_KEY.format(token=body.token)
    raw = await redis.get(token_key)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
        )
    token_data = json.loads(raw)
    user_id = token_data["user_id"]
    admin_user_id = token_data["admin_user_id"]

    user_key = _USER_KEY.format(
        admin_user_id=admin_user_id,
        user_id=user_id,
    )
    user_raw = await redis.get(user_key)
    if not user_raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )
    user_data = json.loads(user_raw)
    name = user_data.get("name", user_id)

    jwt_token = create_jwt(
        user_id=user_id,
        role="user",
        admin_user_id=admin_user_id,
        name=name,
    )
    return LoginResponse(
        token=jwt_token,
        role="user",
        user_id=user_id,
        name=name,
    )


@auth_router.post("/set-credentials")
async def set_credentials(
    body: SetCredentialsRequest,
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> dict:
    admin_id = auth_user.admin_user_id

    # Check if username is taken by someone else
    lookup_key = _USERNAME_LOOKUP_KEY.format(username=body.username)
    existing = await redis.get(lookup_key)
    if existing:
        existing_data = json.loads(existing)
        if existing_data["user_id"] != auth_user.user_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already taken.",
            )

    # Find and delete old credential if user had a different username before
    old_username = None
    if auth_user.role == "admin":
        # Admin: check a dedicated key for admin credential username
        admin_cred_meta_key = f"agentscope:dept_users:{admin_id}:{auth_user.user_id}"
        meta_raw = await redis.get(admin_cred_meta_key)
        if meta_raw:
            meta = json.loads(meta_raw)
            old_username = meta.get("username")
    else:
        user_key = _USER_KEY.format(
            admin_user_id=admin_id, user_id=auth_user.user_id
        )
        user_raw = await redis.get(user_key)
        if user_raw:
            user_data = json.loads(user_raw)
            old_username = user_data.get("username")

    if old_username and old_username != body.username:
        old_cred_key = _CRED_KEY.format(
            admin_user_id=admin_id, username=old_username
        )
        old_lookup_key = _USERNAME_LOOKUP_KEY.format(username=old_username)
        await redis.delete(old_cred_key)
        await redis.delete(old_lookup_key)

    # Store credential
    password_hash = hash_password(body.password)
    name = auth_user.name or body.username
    cred_data = {
        "user_id": auth_user.user_id,
        "admin_user_id": admin_id,
        "password_hash": password_hash,
        "role": auth_user.role,
        "name": name,
    }
    cred_key = _CRED_KEY.format(
        admin_user_id=admin_id, username=body.username
    )
    await redis.set(cred_key, json.dumps(cred_data, ensure_ascii=False))

    # Store global username lookup
    lookup_data = {
        "admin_user_id": admin_id,
        "user_id": auth_user.user_id,
    }
    await redis.set(lookup_key, json.dumps(lookup_data))

    # Update user record with username field
    if auth_user.role == "admin":
        admin_meta_key = f"agentscope:dept_users:{admin_id}:{auth_user.user_id}"
        meta_raw = await redis.get(admin_meta_key)
        meta = json.loads(meta_raw) if meta_raw else {}
        meta["username"] = body.username
        meta["user_id"] = auth_user.user_id
        await redis.set(
            admin_meta_key, json.dumps(meta, ensure_ascii=False)
        )
    else:
        user_key = _USER_KEY.format(
            admin_user_id=admin_id, user_id=auth_user.user_id
        )
        user_raw = await redis.get(user_key)
        if user_raw:
            user_data = json.loads(user_raw)
            user_data["username"] = body.username
            await redis.set(
                user_key, json.dumps(user_data, ensure_ascii=False)
            )

    return {"ok": True}


@auth_router.get("/me", response_model=MeResponse)
async def me(
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> MeResponse:
    admin_id = auth_user.admin_user_id
    has_credentials = False

    # Check if user has set credentials by looking for username in their record
    if auth_user.role == "admin":
        meta_key = f"agentscope:dept_users:{admin_id}:{auth_user.user_id}"
        meta_raw = await redis.get(meta_key)
        if meta_raw:
            meta = json.loads(meta_raw)
            if meta.get("username"):
                has_credentials = True
    else:
        user_key = _USER_KEY.format(
            admin_user_id=admin_id, user_id=auth_user.user_id
        )
        user_raw = await redis.get(user_key)
        if user_raw:
            user_data = json.loads(user_raw)
            if user_data.get("username"):
                has_credentials = True

    return MeResponse(
        user_id=auth_user.user_id,
        role=auth_user.role,
        name=auth_user.name,
        has_credentials=has_credentials,
    )
