# -*- coding: utf-8 -*-
"""Department management router."""
import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

import department_client
from auth import AuthUser, get_current_user
from db import get_db, new_id, now_iso

dept_router = APIRouter(prefix="/departments", tags=["departments"])


class CreateDeptRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    backend_url: str = Field(..., min_length=1)
    frontend_url: str = Field(default="")
    admin_username: str = Field(default="admin")
    admin_password: str = Field(..., min_length=1)


class UpdateDeptRequest(BaseModel):
    name: str | None = None
    backend_url: str | None = None
    frontend_url: str | None = None
    admin_username: str | None = None
    admin_password: str | None = None


class DeptResponse(BaseModel):
    id: str
    name: str
    backend_url: str
    frontend_url: str
    admin_username: str
    admin_password: str
    created_at: str


class DeptHealthResponse(BaseModel):
    id: str
    name: str
    online: bool


@dept_router.post("/", response_model=DeptResponse, status_code=201)
async def create_department(
    body: CreateDeptRequest,
    user: AuthUser = Depends(get_current_user),
):
    dept_id = new_id()
    created_at = now_iso()
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO departments (id, name, backend_url, frontend_url, admin_username, admin_password, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (dept_id, body.name, body.backend_url.strip().rstrip("/"), body.frontend_url.strip().rstrip("/"), body.admin_username, body.admin_password, created_at),
        )
        await db.commit()
    finally:
        await db.close()
    return DeptResponse(
        id=dept_id, name=body.name, backend_url=body.backend_url.strip().rstrip("/"),
        frontend_url=body.frontend_url.strip().rstrip("/"),
        admin_username=body.admin_username, admin_password=body.admin_password, created_at=created_at,
    )


@dept_router.get("/", response_model=list[DeptResponse])
async def list_departments(user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, name, backend_url, frontend_url, admin_username, admin_password, created_at FROM departments ORDER BY created_at")
        rows = await cursor.fetchall()
    finally:
        await db.close()
    return [DeptResponse(id=r["id"], name=r["name"], backend_url=r["backend_url"], frontend_url=r["frontend_url"] or "", admin_username=r["admin_username"], admin_password=r["admin_password"], created_at=r["created_at"]) for r in rows]


@dept_router.get("/{dept_id}", response_model=DeptResponse)
async def get_department(dept_id: str, user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, name, backend_url, frontend_url, admin_username, admin_password, created_at FROM departments WHERE id = ?", (dept_id,))
        row = await cursor.fetchone()
    finally:
        await db.close()
    if not row:
        raise HTTPException(status_code=404, detail="Department not found.")
    return DeptResponse(id=row["id"], name=row["name"], backend_url=row["backend_url"], frontend_url=row["frontend_url"] or "", admin_username=row["admin_username"], admin_password=row["admin_password"], created_at=row["created_at"])


@dept_router.put("/{dept_id}", response_model=DeptResponse)
async def update_department(dept_id: str, body: UpdateDeptRequest, user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM departments WHERE id = ?", (dept_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Department not found.")

        updates = {}
        if body.name is not None:
            updates["name"] = body.name
        if body.backend_url is not None:
            updates["backend_url"] = body.backend_url.strip().rstrip("/")
        if body.frontend_url is not None:
            updates["frontend_url"] = body.frontend_url.strip().rstrip("/")
        if body.admin_username is not None:
            updates["admin_username"] = body.admin_username
        if body.admin_password is not None:
            updates["admin_password"] = body.admin_password

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [dept_id]
            await db.execute(f"UPDATE departments SET {set_clause} WHERE id = ?", values)
            await db.commit()

        cursor = await db.execute("SELECT id, name, backend_url, frontend_url, admin_username, admin_password, created_at FROM departments WHERE id = ?", (dept_id,))
        row = await cursor.fetchone()
    finally:
        await db.close()
    return DeptResponse(id=row["id"], name=row["name"], backend_url=row["backend_url"], frontend_url=row["frontend_url"] or "", admin_username=row["admin_username"], admin_password=row["admin_password"], created_at=row["created_at"])


@dept_router.delete("/{dept_id}", status_code=204)
async def delete_department(dept_id: str, user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id FROM departments WHERE id = ?", (dept_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Department not found.")
        await db.execute("DELETE FROM departments WHERE id = ?", (dept_id,))
        await db.commit()
    finally:
        await db.close()


@dept_router.get("/{dept_id}/health", response_model=DeptHealthResponse)
async def check_health(dept_id: str, user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, name, backend_url FROM departments WHERE id = ?", (dept_id,))
        row = await cursor.fetchone()
    finally:
        await db.close()
    if not row:
        raise HTTPException(status_code=404, detail="Department not found.")
    online = await department_client.health_check(row["backend_url"])
    return DeptHealthResponse(id=row["id"], name=row["name"], online=online)


@dept_router.post("/{dept_id}/test-connection")
async def test_connection(dept_id: str, user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT backend_url, admin_username, admin_password FROM departments WHERE id = ?", (dept_id,))
        row = await cursor.fetchone()
    finally:
        await db.close()
    if not row:
        raise HTTPException(status_code=404, detail="Department not found.")

    token = await department_client.login(row["backend_url"], row["admin_username"], row["admin_password"])
    if not token:
        return {"ok": False, "detail": "Failed to login to department backend."}
    return {"ok": True}
