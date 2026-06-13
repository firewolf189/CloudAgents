# -*- coding: utf-8 -*-
"""Task management router — update or cancel tasks in a session."""
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

task_router = APIRouter(prefix="/tasks", tags=["tasks"])


async def _get_user_id(request: Request) -> str:
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user:
        return auth_user.admin_user_id
    user_id = request.headers.get("X-User-ID", "")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-User-ID header is required.",
        )
    return user_id


async def _get_storage(request: Request) -> Any:
    return request.app.state.storage


class UpdateTaskRequest(BaseModel):
    state: Literal["pending", "in_progress", "completed"]


class ClearTasksRequest(BaseModel):
    mode: Literal["all", "completed", "stuck"] = "stuck"


@task_router.patch("/{task_id}")
async def update_task(
    task_id: str,
    body: UpdateTaskRequest,
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(_get_user_id),
    storage: Any = Depends(_get_storage),
) -> dict:
    """Update a single task's state."""
    session = await storage.get_session(user_id, agent_id, session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found.",
        )

    state = session.state
    tc = state.tasks_context
    task = next((t for t in tc.tasks if str(t.id) == task_id), None)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id!r} not found.",
        )

    task.state = body.state
    await storage.update_session_state(user_id, agent_id, session_id, state)
    return {"status": "ok", "task_id": task_id, "state": body.state}


@task_router.post("/clear")
async def clear_tasks(
    body: ClearTasksRequest,
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(_get_user_id),
    storage: Any = Depends(_get_storage),
) -> dict:
    """Clear tasks from a session.

    Modes:
      - stuck: mark all in_progress tasks as completed
      - completed: remove all completed tasks
      - all: remove all tasks
    """
    session = await storage.get_session(user_id, agent_id, session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found.",
        )

    state = session.state
    tc = state.tasks_context
    count = 0

    if body.mode == "stuck":
        for t in tc.tasks:
            if t.state == "in_progress":
                t.state = "completed"
                count += 1
    elif body.mode == "completed":
        before = len(tc.tasks)
        tc.tasks = [t for t in tc.tasks if t.state != "completed"]
        count = before - len(tc.tasks)
    elif body.mode == "all":
        count = len(tc.tasks)
        tc.tasks = []

    await storage.update_session_state(user_id, agent_id, session_id, state)
    return {"status": "ok", "mode": body.mode, "affected": count}
