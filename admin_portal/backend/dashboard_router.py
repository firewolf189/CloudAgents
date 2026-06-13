# -*- coding: utf-8 -*-
"""Dashboard router — aggregate data from all departments."""
import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import department_client
from auth import AuthUser, get_current_user
from db import get_db

dashboard_router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class DeptSummary(BaseModel):
    id: str
    name: str
    backend_url: str
    online: bool
    agent_count: int
    user_count: int


class DashboardResponse(BaseModel):
    total_departments: int
    online_departments: int
    total_agents: int
    total_users: int
    departments: list[DeptSummary]


async def _fetch_dept_summary(dept: dict) -> DeptSummary:
    url = dept["backend_url"]
    online = await department_client.health_check(url)
    agent_count = 0
    user_count = 0

    if online:
        token = await department_client.login(url, dept["admin_username"], dept["admin_password"])
        if token:
            agents = await department_client.get_agents(url, token)
            users = await department_client.get_users(url, token)
            agent_count = len(agents)
            user_count = len(users)

    return DeptSummary(
        id=dept["id"],
        name=dept["name"],
        backend_url=url,
        online=online,
        agent_count=agent_count,
        user_count=user_count,
    )


@dashboard_router.get("/", response_model=DashboardResponse)
async def get_dashboard(user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, name, backend_url, admin_username, admin_password FROM departments")
        rows = await cursor.fetchall()
    finally:
        await db.close()

    depts = [dict(r) for r in rows]
    summaries = await asyncio.gather(*[_fetch_dept_summary(d) for d in depts])

    return DashboardResponse(
        total_departments=len(summaries),
        online_departments=sum(1 for s in summaries if s.online),
        total_agents=sum(s.agent_count for s in summaries),
        total_users=sum(s.user_count for s in summaries),
        departments=list(summaries),
    )


class AgentInfo(BaseModel):
    id: str
    name: str
    description: str
    department_id: str
    department_name: str


class AllAgentsResponse(BaseModel):
    departments: list[dict]


@dashboard_router.get("/agents", response_model=AllAgentsResponse)
async def get_all_agents(user: AuthUser = Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, name, backend_url, admin_username, admin_password FROM departments ORDER BY created_at")
        rows = await cursor.fetchall()
    finally:
        await db.close()

    result = []
    for row in rows:
        dept = dict(row)
        token = await department_client.login(dept["backend_url"], dept["admin_username"], dept["admin_password"])
        agents_list = []
        if token:
            raw_agents = await department_client.get_agents(dept["backend_url"], token)
            for a in raw_agents:
                data = a.get("data", {})
                agents_list.append({
                    "id": a.get("id", ""),
                    "name": data.get("name", ""),
                    "description": data.get("system_prompt", "")[:100],
                })
        result.append({
            "department_id": dept["id"],
            "department_name": dept["name"],
            "backend_url": dept["backend_url"],
            "frontend_url": dept.get("frontend_url", ""),
            "agents": agents_list,
        })

    return AllAgentsResponse(departments=result)
