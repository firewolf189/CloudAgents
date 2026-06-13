# -*- coding: utf-8 -*-
"""Chat proxy router — chat with department agents from admin portal."""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import department_client
from auth import AuthUser, get_current_user
from db import get_db

chat_router = APIRouter(prefix="/chat", tags=["chat"])


async def _get_dept_and_token(dept_id: str) -> tuple[dict, str]:
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, name, backend_url, admin_username, admin_password FROM departments WHERE id = ?",
            (dept_id,),
        )
        row = await cursor.fetchone()
    finally:
        await db.close()
    if not row:
        raise HTTPException(status_code=404, detail="Department not found.")
    dept = dict(row)
    token = await department_client.login(dept["backend_url"], dept["admin_username"], dept["admin_password"])
    if not token:
        raise HTTPException(status_code=502, detail="Failed to login to department backend.")
    return dept, token


class StartChatRequest(BaseModel):
    department_id: str
    agent_id: str


class StartChatResponse(BaseModel):
    session_id: str
    department_id: str
    agent_id: str


class SendMessageRequest(BaseModel):
    department_id: str
    agent_id: str
    session_id: str
    text: str = Field(..., min_length=1)


class ChatMessage(BaseModel):
    role: str
    text: str


class SendMessageResponse(BaseModel):
    reply: str


class MessagesResponse(BaseModel):
    messages: list[ChatMessage]


@chat_router.post("/start", response_model=StartChatResponse)
async def start_chat(
    body: StartChatRequest,
    user: AuthUser = Depends(get_current_user),
):
    dept, token = await _get_dept_and_token(body.department_id)
    result = await department_client.create_session(dept["backend_url"], token, body.agent_id)
    if not result:
        raise HTTPException(status_code=502, detail="Failed to create session.")
    session_id = result.get("session", {}).get("id") or result.get("session_id")
    return StartChatResponse(
        session_id=session_id,
        department_id=body.department_id,
        agent_id=body.agent_id,
    )


@chat_router.post("/send", response_model=SendMessageResponse)
async def send_message(
    body: SendMessageRequest,
    user: AuthUser = Depends(get_current_user),
):
    dept, token = await _get_dept_and_token(body.department_id)
    ok = await department_client.send_message(
        dept["backend_url"], token, body.agent_id, body.session_id, body.text,
    )
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to send message.")
    reply = await department_client.poll_reply(
        dept["backend_url"], token, body.session_id, body.agent_id,
    )
    return SendMessageResponse(reply=reply)


@chat_router.get("/messages")
async def get_messages(
    department_id: str,
    agent_id: str,
    session_id: str,
    user: AuthUser = Depends(get_current_user),
):
    dept, token = await _get_dept_and_token(department_id)
    messages = await department_client.get_messages(
        dept["backend_url"], token, session_id, agent_id,
    )
    result = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", [])
        texts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(block.get("text", ""))
            elif isinstance(block, str):
                texts.append(block)
        if texts:
            result.append(ChatMessage(role=role, text="\n".join(texts)))
    return MessagesResponse(messages=result)
