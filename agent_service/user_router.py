# -*- coding: utf-8 -*-
"""User (employee) management router — admin only."""
import json
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from auth import (
    AuthUser,
    generate_employee_token,
    get_current_user,
    require_admin,
)

user_router = APIRouter(prefix="/users", tags=["users"])

_USER_KEY = "agentscope:dept_users:{admin_user_id}:{user_id}"
_USER_INDEX = "agentscope:dept_users_index:{admin_user_id}"
_TOKEN_KEY = "agentscope:dept_tokens:{token}"
_CRED_KEY = "agentscope:dept_credentials:{admin_user_id}:{username}"
_USERNAME_LOOKUP_KEY = "agentscope:username_lookup:{username}"


async def _get_redis(request: Request) -> Any:
    storage = request.app.state.storage
    return storage.get_client()


class CreateUserRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


class UserRecord(BaseModel):
    user_id: str
    name: str
    token: str
    created_at: str


class UserListItem(BaseModel):
    user_id: str
    name: str
    created_at: str


@user_router.post("/", response_model=UserRecord, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: CreateUserRequest,
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> UserRecord:
    require_admin(auth_user)
    admin_id = auth_user.admin_user_id

    user_id = uuid.uuid4().hex[:12]
    token = generate_employee_token()
    now = datetime.now().isoformat()

    record = {
        "user_id": user_id,
        "name": body.name,
        "token": token,
        "created_at": now,
    }

    user_key = _USER_KEY.format(admin_user_id=admin_id, user_id=user_id)
    await redis.set(user_key, json.dumps(record, ensure_ascii=False))

    index_key = _USER_INDEX.format(admin_user_id=admin_id)
    await redis.sadd(index_key, user_id)

    token_key = _TOKEN_KEY.format(token=token)
    token_data = {"user_id": user_id, "admin_user_id": admin_id}
    await redis.set(token_key, json.dumps(token_data))

    return UserRecord(**record)


@user_router.get("/", response_model=list[UserListItem])
async def list_users(
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> list[UserListItem]:
    require_admin(auth_user)
    admin_id = auth_user.admin_user_id

    index_key = _USER_INDEX.format(admin_user_id=admin_id)
    user_ids = await redis.smembers(index_key)

    users = []
    for uid in user_ids:
        user_key = _USER_KEY.format(admin_user_id=admin_id, user_id=uid)
        raw = await redis.get(user_key)
        if raw:
            data = json.loads(raw)
            users.append(UserListItem(
                user_id=data["user_id"],
                name=data["name"],
                created_at=data["created_at"],
            ))

    users.sort(key=lambda u: u.created_at)
    return users


@user_router.get("/{user_id}", response_model=UserRecord)
async def get_user(
    user_id: str,
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> UserRecord:
    require_admin(auth_user)
    admin_id = auth_user.admin_user_id

    user_key = _USER_KEY.format(admin_user_id=admin_id, user_id=user_id)
    raw = await redis.get(user_key)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id!r} not found.",
        )
    return UserRecord(**json.loads(raw))


@user_router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> None:
    require_admin(auth_user)
    admin_id = auth_user.admin_user_id

    user_key = _USER_KEY.format(admin_user_id=admin_id, user_id=user_id)
    raw = await redis.get(user_key)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id!r} not found.",
        )

    data = json.loads(raw)
    old_token = data.get("token", "")
    if old_token:
        await redis.delete(_TOKEN_KEY.format(token=old_token))

    # Clean up credential keys if employee had set a username/password
    old_username = data.get("username")
    if old_username:
        await redis.delete(
            _CRED_KEY.format(admin_user_id=admin_id, username=old_username)
        )
        await redis.delete(
            _USERNAME_LOOKUP_KEY.format(username=old_username)
        )

    await redis.delete(user_key)
    index_key = _USER_INDEX.format(admin_user_id=admin_id)
    await redis.srem(index_key, user_id)


@user_router.post("/{user_id}/regenerate-token", response_model=UserRecord)
async def regenerate_token(
    user_id: str,
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> UserRecord:
    require_admin(auth_user)
    admin_id = auth_user.admin_user_id

    user_key = _USER_KEY.format(admin_user_id=admin_id, user_id=user_id)
    raw = await redis.get(user_key)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id!r} not found.",
        )

    data = json.loads(raw)
    old_token = data.get("token", "")
    if old_token:
        await redis.delete(_TOKEN_KEY.format(token=old_token))

    new_token = generate_employee_token()
    data["token"] = new_token
    await redis.set(user_key, json.dumps(data, ensure_ascii=False))

    token_key = _TOKEN_KEY.format(token=new_token)
    token_data = {"user_id": user_id, "admin_user_id": admin_id}
    await redis.set(token_key, json.dumps(token_data))

    return UserRecord(**data)
