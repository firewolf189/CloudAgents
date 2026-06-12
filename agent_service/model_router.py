# -*- coding: utf-8 -*-
"""Custom model management router.

Provides CRUD for user-defined model configurations stored in Redis,
and overrides the built-in GET /model/ to merge custom models with
the static YAML-defined ones.
"""
import json
import time
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from agentscope.credential import CredentialFactory
from agentscope.model import ModelCard


# ── Redis key helpers ────────────────────────────────────────────────────────

CUSTOM_MODEL_KEY = "agentscope:user:{user_id}:custom_model:{model_id}"
CUSTOM_MODEL_INDEX = "agentscope:user:{user_id}:custom_models:{provider}"
HIDDEN_MODEL_KEY = "agentscope:user:{user_id}:hidden_models:{provider}"


def _hidden_key(user_id: str, provider: str) -> str:
    return HIDDEN_MODEL_KEY.format(user_id=user_id, provider=provider)


def _model_key(user_id: str, model_id: str) -> str:
    return CUSTOM_MODEL_KEY.format(user_id=user_id, model_id=model_id)


def _index_key(user_id: str, provider: str) -> str:
    return CUSTOM_MODEL_INDEX.format(user_id=user_id, provider=provider)


# ── Request / Response schemas ───────────────────────────────────────────────

class CustomModelRecord(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    provider: str
    name: str
    label: str
    status: str = "active"
    input_types: list[str] = Field(default_factory=lambda: ["text/plain"])
    output_types: list[str] = Field(default_factory=lambda: ["text/plain"])
    context_size: int = 32768
    output_size: int = 8192
    is_custom: bool = True
    created_at: str = Field(
        default_factory=lambda: datetime.now().isoformat(),
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now().isoformat(),
    )


class CreateCustomModelRequest(BaseModel):
    provider: str = Field(description="Provider type, e.g. dashscope_credential")
    name: str = Field(description="Model name, e.g. my-custom-model")
    label: str = Field(description="Display label")
    status: str = "active"
    input_types: list[str] = Field(default_factory=lambda: ["text/plain"])
    output_types: list[str] = Field(default_factory=lambda: ["text/plain"])
    context_size: int = 32768
    output_size: int = 8192


class UpdateCustomModelRequest(BaseModel):
    name: str | None = None
    label: str | None = None
    status: str | None = None
    input_types: list[str] | None = None
    output_types: list[str] | None = None
    context_size: int | None = None
    output_size: int | None = None


class CreateCustomModelResponse(BaseModel):
    model_id: str


class ListModelsResponse(BaseModel):
    models: list[dict[str, Any]]
    total: int


class TestConnectivityRequest(BaseModel):
    credential_id: str = Field(description="The credential ID to use")
    model_name: str = Field(description="The model name to test")


class TestConnectivityResponse(BaseModel):
    success: bool
    latency_ms: int = 0
    error: str | None = None


# ── Dependencies ─────────────────────────────────────────────────────────────

async def _get_redis(request: Request) -> Any:
    storage = request.app.state.storage
    return storage.get_client()


async def _get_storage(request: Request) -> Any:
    return request.app.state.storage


async def _get_user_id(request: Request) -> str:
    user_id = request.headers.get("X-User-ID", "")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-User-ID header is required.",
        )
    return user_id


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _list_custom_models(
    redis: Any,
    user_id: str,
    provider: str,
) -> list[CustomModelRecord]:
    index_key = _index_key(user_id, provider)
    ids = await redis.smembers(index_key)
    records = []
    for mid in ids:
        mid_str = mid if isinstance(mid, str) else mid.decode()
        raw = await redis.get(_model_key(user_id, mid_str))
        if raw:
            data = json.loads(raw)
            records.append(CustomModelRecord(**data))
    return records


def _custom_to_model_card_dict(record: CustomModelRecord) -> dict[str, Any]:
    return {
        "type": "chat_model",
        "id": record.id,
        "name": record.name,
        "label": record.label,
        "status": record.status,
        "deprecated_at": None,
        "input_types": record.input_types,
        "output_types": record.output_types,
        "context_size": record.context_size,
        "output_size": record.output_size,
        "parameter_schema": {"type": "object", "properties": {}, "required": []},
        "parameters_overrides": {},
        "is_custom": True,
    }


def _builtin_to_dict(card: ModelCard) -> dict[str, Any]:
    d = card.model_dump()
    d["is_custom"] = False
    return d


# ── Router ───────────────────────────────────────────────────────────────────

model_router = APIRouter(
    prefix="/model",
    tags=["model"],
    responses={404: {"description": "Not found"}},
)


@model_router.get(
    "/",
    response_model=ListModelsResponse,
    summary="List all models (built-in + custom) for a provider",
)
async def list_models(
    provider: str,
    redis: Any = Depends(_get_redis),
    user_id: str = Depends(_get_user_id),
) -> ListModelsResponse:
    credential_cls = CredentialFactory.get_credential_class(provider)

    builtin_models: list[dict[str, Any]] = []
    if credential_cls is not None:
        for card in credential_cls.get_chat_model_class().list_models():
            builtin_models.append(_builtin_to_dict(card))

    custom_records = await _list_custom_models(redis, user_id, provider)
    custom_names = {r.name for r in custom_records}

    hidden_raw = await redis.smembers(_hidden_key(user_id, provider))
    hidden_names = {
        n if isinstance(n, str) else n.decode() for n in hidden_raw
    }

    merged: list[dict[str, Any]] = []
    for bm in builtin_models:
        if bm["name"] not in custom_names and bm["name"] not in hidden_names:
            merged.append(bm)

    for cr in custom_records:
        merged.append(_custom_to_model_card_dict(cr))

    return ListModelsResponse(models=merged, total=len(merged))


@model_router.post(
    "/custom",
    response_model=CreateCustomModelResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom model",
)
async def create_custom_model(
    body: CreateCustomModelRequest,
    redis: Any = Depends(_get_redis),
    user_id: str = Depends(_get_user_id),
) -> CreateCustomModelResponse:
    record = CustomModelRecord(
        provider=body.provider,
        name=body.name,
        label=body.label,
        status=body.status,
        input_types=body.input_types,
        output_types=body.output_types,
        context_size=body.context_size,
        output_size=body.output_size,
    )
    key = _model_key(user_id, record.id)
    index_key = _index_key(user_id, body.provider)
    await redis.set(key, record.model_dump_json())
    await redis.sadd(index_key, record.id)
    return CreateCustomModelResponse(model_id=record.id)


@model_router.patch(
    "/custom/{model_id}",
    response_model=CustomModelRecord,
    summary="Update a custom model",
)
async def update_custom_model(
    model_id: str,
    body: UpdateCustomModelRequest,
    redis: Any = Depends(_get_redis),
    user_id: str = Depends(_get_user_id),
) -> CustomModelRecord:
    key = _model_key(user_id, model_id)
    raw = await redis.get(key)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Custom model '{model_id}' not found.",
        )
    record = CustomModelRecord(**json.loads(raw))

    old_name = record.name
    updates = body.model_dump(exclude_none=True)
    for field, value in updates.items():
        setattr(record, field, value)
    record.updated_at = datetime.now().isoformat()

    if "name" in updates and updates["name"] != old_name:
        pass

    await redis.set(key, record.model_dump_json())
    return record


@model_router.delete(
    "/custom/{model_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a custom model",
)
async def delete_custom_model(
    model_id: str,
    redis: Any = Depends(_get_redis),
    user_id: str = Depends(_get_user_id),
) -> None:
    key = _model_key(user_id, model_id)
    raw = await redis.get(key)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Custom model '{model_id}' not found.",
        )
    record = CustomModelRecord(**json.loads(raw))
    index_key = _index_key(user_id, record.provider)
    await redis.delete(key)
    await redis.srem(index_key, model_id)


class HideModelRequest(BaseModel):
    provider: str = Field(description="Provider type")
    model_name: str = Field(description="Built-in model name to hide")


@model_router.post(
    "/hide",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Hide a built-in model",
)
async def hide_builtin_model(
    body: HideModelRequest,
    redis: Any = Depends(_get_redis),
    user_id: str = Depends(_get_user_id),
) -> None:
    await redis.sadd(_hidden_key(user_id, body.provider), body.model_name)


@model_router.post(
    "/unhide",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unhide a built-in model",
)
async def unhide_builtin_model(
    body: HideModelRequest,
    redis: Any = Depends(_get_redis),
    user_id: str = Depends(_get_user_id),
) -> None:
    await redis.srem(_hidden_key(user_id, body.provider), body.model_name)


@model_router.post(
    "/test",
    response_model=TestConnectivityResponse,
    summary="Test model connectivity",
)
async def test_connectivity(
    body: TestConnectivityRequest,
    storage: Any = Depends(_get_storage),
    user_id: str = Depends(_get_user_id),
) -> TestConnectivityResponse:
    from agentscope.message import UserMsg

    record = await storage.get_credential(user_id, body.credential_id)
    if record is None:
        return TestConnectivityResponse(
            success=False,
            error="Credential not found.",
        )

    try:
        credential = CredentialFactory.from_dict(record.data)
        chat_model_cls = credential.get_chat_model_class()
        model = chat_model_cls(
            credential=credential,
            model=body.model_name,
            stream=False,
            max_retries=0,
        )

        msg = UserMsg(name="test", content="hi")
        start = time.monotonic()
        await model([msg])
        latency = int((time.monotonic() - start) * 1000)

        return TestConnectivityResponse(success=True, latency_ms=latency)
    except Exception as e:
        err_msg = str(e)
        if len(err_msg) > 200:
            err_msg = err_msg[:200] + "..."
        return TestConnectivityResponse(success=False, error=err_msg)
