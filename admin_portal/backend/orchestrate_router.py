# -*- coding: utf-8 -*-
"""Cross-department orchestration router."""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import department_client
from auth import AuthUser, get_current_user
from db import get_db, new_id, now_iso

orchestrate_router = APIRouter(prefix="/orchestrate", tags=["orchestrate"])


class RunRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    department_ids: list[str] = Field(..., min_length=1)


class LogEntry(BaseModel):
    id: str
    task_type: str
    task_prompt: str
    department_ids: list[str]
    results: dict | None
    status: str
    created_at: str
    finished_at: str | None


class RunResponse(BaseModel):
    id: str
    status: str
    results: dict


async def _call_dept(dept: dict, prompt: str) -> tuple[str, str]:
    url = dept["backend_url"]
    token = await department_client.login(url, dept["admin_username"], dept["admin_password"])
    if not token:
        return dept["name"], f"[{dept['name']}] 无法登录后端"

    agents = await department_client.get_agents(url, token)
    if not agents:
        return dept["name"], f"[{dept['name']}] 没有可用的 Agent"

    agent_id = agents[0].get("id") or agents[0].get("agent_id")
    result = await department_client.call_agent(url, token, agent_id, prompt)
    return dept["name"], result


@orchestrate_router.post("/run", response_model=RunResponse)
async def run_orchestration(
    body: RunRequest,
    user: AuthUser = Depends(get_current_user),
):
    db = await get_db()
    try:
        # Fetch selected departments
        placeholders = ",".join("?" for _ in body.department_ids)
        cursor = await db.execute(
            f"SELECT id, name, backend_url, admin_username, admin_password FROM departments WHERE id IN ({placeholders})",
            body.department_ids,
        )
        rows = await cursor.fetchall()
    finally:
        await db.close()

    if not rows:
        raise HTTPException(status_code=404, detail="No departments found.")

    depts = [dict(r) for r in rows]

    # Create log entry
    log_id = new_id()
    created_at = now_iso()

    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO orchestrate_logs (id, task_type, task_prompt, department_ids, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (log_id, "custom", body.prompt, json.dumps(body.department_ids), "running", created_at),
        )
        await db.commit()
    finally:
        await db.close()

    # Run in parallel
    tasks = [_call_dept(d, body.prompt) for d in depts]
    results_list = await asyncio.gather(*tasks, return_exceptions=True)

    results = {}
    for item in results_list:
        if isinstance(item, Exception):
            results["error"] = str(item)
        else:
            name, text = item
            results[name] = text

    # Update log
    finished_at = now_iso()
    db = await get_db()
    try:
        await db.execute(
            "UPDATE orchestrate_logs SET results = ?, status = ?, finished_at = ? WHERE id = ?",
            (json.dumps(results, ensure_ascii=False), "done", finished_at, log_id),
        )
        await db.commit()
    finally:
        await db.close()

    return RunResponse(id=log_id, status="done", results=results)


@orchestrate_router.get("/logs", response_model=list[LogEntry])
async def list_logs(user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM orchestrate_logs ORDER BY created_at DESC LIMIT 50")
        rows = await cursor.fetchall()
    finally:
        await db.close()

    return [
        LogEntry(
            id=r["id"],
            task_type=r["task_type"],
            task_prompt=r["task_prompt"],
            department_ids=json.loads(r["department_ids"]),
            results=json.loads(r["results"]) if r["results"] else None,
            status=r["status"],
            created_at=r["created_at"],
            finished_at=r["finished_at"],
        )
        for r in rows
    ]


@orchestrate_router.get("/logs/{log_id}", response_model=LogEntry)
async def get_log(log_id: str, user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM orchestrate_logs WHERE id = ?", (log_id,))
        r = await cursor.fetchone()
    finally:
        await db.close()
    if not r:
        raise HTTPException(status_code=404, detail="Log not found.")
    return LogEntry(
        id=r["id"],
        task_type=r["task_type"],
        task_prompt=r["task_prompt"],
        department_ids=json.loads(r["department_ids"]),
        results=json.loads(r["results"]) if r["results"] else None,
        status=r["status"],
        created_at=r["created_at"],
        finished_at=r["finished_at"],
    )
