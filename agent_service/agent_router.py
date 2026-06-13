# -*- coding: utf-8 -*-
"""Agent router — override core /agent/ with assignment support."""
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from auth import AuthUser, get_current_user, require_admin

agent_router = APIRouter(prefix="/agent", tags=["agent"])

_ASSIGN_KEY = "agentscope:agent_assign:{admin_user_id}:{agent_id}"
_ASSIGN_INDEX = "agentscope:agent_assign_index:{admin_user_id}:{user_id}"


async def _get_redis(request: Request) -> Any:
    storage = request.app.state.storage
    return storage.get_client()


async def _get_storage(request: Request) -> Any:
    return request.app.state.storage


class AssignAgentRequest(BaseModel):
    assigned_to: str


class AgentAssignment(BaseModel):
    agent_id: str
    assigned_to: str | None


@agent_router.get("/assignments")
async def list_assignments(
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> list[AgentAssignment]:
    """List all agent assignments. Admin sees all, user sees own."""
    admin_id = auth_user.admin_user_id
    storage = None

    if auth_user.role == "admin":
        agents = await _list_all_agents(redis, admin_id)
    else:
        index_key = _ASSIGN_INDEX.format(
            admin_user_id=admin_id,
            user_id=auth_user.user_id,
        )
        agent_ids = await redis.smembers(index_key)
        agents = list(agent_ids)

    result = []
    for agent_id in agents:
        assign_key = _ASSIGN_KEY.format(
            admin_user_id=admin_id,
            agent_id=agent_id,
        )
        assigned_to = await redis.get(assign_key)
        result.append(AgentAssignment(
            agent_id=agent_id,
            assigned_to=assigned_to if assigned_to else None,
        ))
    return result


async def _list_all_agents(redis: Any, admin_user_id: str) -> list[str]:
    """Scan Redis for all agent IDs under this admin."""
    pattern = f"agentscope:user:{admin_user_id}:agent:*"
    agent_ids = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match=pattern, count=100)
        for key in keys:
            if ":sessions" not in key:
                parts = key.split(":")
                agent_ids.append(parts[-1])
        if cursor == 0:
            break
    return agent_ids


@agent_router.patch("/{agent_id}/assign")
async def assign_agent(
    agent_id: str,
    body: AssignAgentRequest,
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> dict:
    """Assign an agent to an employee. Admin only."""
    require_admin(auth_user)
    admin_id = auth_user.admin_user_id

    assign_key = _ASSIGN_KEY.format(
        admin_user_id=admin_id,
        agent_id=agent_id,
    )

    old_assigned = await redis.get(assign_key)
    if old_assigned:
        old_index = _ASSIGN_INDEX.format(
            admin_user_id=admin_id,
            user_id=old_assigned,
        )
        await redis.srem(old_index, agent_id)

    await redis.set(assign_key, body.assigned_to)

    new_index = _ASSIGN_INDEX.format(
        admin_user_id=admin_id,
        user_id=body.assigned_to,
    )
    await redis.sadd(new_index, agent_id)

    return {"status": "ok", "agent_id": agent_id, "assigned_to": body.assigned_to}


@agent_router.delete("/{agent_id}/assign", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_agent(
    agent_id: str,
    redis: Any = Depends(_get_redis),
    auth_user: AuthUser = Depends(get_current_user),
) -> None:
    """Remove agent assignment. Admin only."""
    require_admin(auth_user)
    admin_id = auth_user.admin_user_id

    assign_key = _ASSIGN_KEY.format(
        admin_user_id=admin_id,
        agent_id=agent_id,
    )
    old_assigned = await redis.get(assign_key)
    if old_assigned:
        old_index = _ASSIGN_INDEX.format(
            admin_user_id=admin_id,
            user_id=old_assigned,
        )
        await redis.srem(old_index, agent_id)

    await redis.delete(assign_key)
