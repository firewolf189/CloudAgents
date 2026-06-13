# -*- coding: utf-8 -*-
"""The example script to start the agent service."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import uvicorn
from fastapi import Request, Response
from fastapi.middleware import Middleware
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from agentscope.app import create_app, SubAgentTemplate
from agentscope.app.message_bus import RedisMessageBus
from agentscope.app.storage import RedisStorage
from agentscope.app.workspace_manager import LocalWorkspaceManager
from agentscope.mcp import MCPClient, StdioMCPConfig, HttpMCPConfig
from agentscope.permission import PermissionContext, PermissionMode

from auth import decode_jwt, ADMIN_USERNAME
from agent_router import agent_router
from auth_router import auth_router
from model_router import model_router as custom_model_router
from skill_install_router import skill_install_router
from task_router import task_router
from user_router import user_router
from workspace_files_router import workspace_files_router

# ── Auth middleware ───────────────────────────────────────────────────────────

OPEN_PATHS = {"/auth/login", "/auth/login/token", "/docs", "/openapi.json", "/redoc"}


class AuthMiddleware(BaseHTTPMiddleware):
    """Validate JWT and inject X-User-ID for core library routes."""

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Let CORS preflight through unconditionally
        if request.method == "OPTIONS":
            return await call_next(request)

        if path in OPEN_PATHS or path.startswith("/auth/"):
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return Response(
                content='{"detail":"Authorization header required."}',
                status_code=401,
                media_type="application/json",
            )

        token = auth_header[7:]
        try:
            payload = decode_jwt(token)
        except Exception:
            return Response(
                content='{"detail":"Invalid or expired token."}',
                status_code=401,
                media_type="application/json",
            )

        from dataclasses import dataclass

        @dataclass
        class _AuthUser:
            user_id: str
            role: str
            admin_user_id: str
            name: str = ""

        auth_user = _AuthUser(
            user_id=payload["user_id"],
            role=payload["role"],
            admin_user_id=payload["admin_user_id"],
            name=payload.get("name", ""),
        )
        request.state.auth_user = auth_user

        # For core library routes that read X-User-ID:
        # - Credential/model routes → use admin_user_id (shared credentials)
        # - Agent/session routes → use admin_user_id (all agents live under admin namespace)
        x_user_id = auth_user.admin_user_id

        # Inject X-User-ID into the request headers (immutable, so we rebuild)
        headers = dict(request.scope["headers"])
        new_headers = []
        for k, v in request.scope["headers"]:
            if k.lower() != b"x-user-id":
                new_headers.append((k, v))
        new_headers.append((b"x-user-id", x_user_id.encode()))
        request.scope["headers"] = new_headers

        return await call_next(request)


# ── App setup ─────────────────────────────────────────────────────────────────

default_mcps = [
    MCPClient(
        name="browser-use",
        mcp_config=StdioMCPConfig(
            command="npx",
            args=["@playwright/mcp@latest"],
        ),
        is_stateful=True,
    ),
]

if os.getenv("AMAP_API_KEY"):
    default_mcps.append(
        MCPClient(
            name="amap",
            mcp_config=HttpMCPConfig(
                url=f"https://mcp.amap.com/mcp?key="
                f"{os.environ['AMAP_API_KEY']}",
            ),
            is_stateful=False,
        ),
    )

app = create_app(
    storage=RedisStorage(
        host="localhost",
        port=6379,
    ),
    message_bus=RedisMessageBus(
        host="localhost",
        port=6379,
    ),
    workspace_manager=LocalWorkspaceManager(
        basedir=os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "workspaces",
        ),
        # The default MCP servers that will be added into the workspace
        default_mcps=default_mcps,
    ),
    # Customize your own subagent templates
    custom_subagent_templates=[
        SubAgentTemplate(
            type="explorer",
            description=(
                "Read-only agents specialized in exploration tasks. It can "
                "read files but cannot modify, create, or delete them. Use "
                "this agent type when you need to investigate the codebase, "
                "understand its structure, or gather information from files "
                "to support planning—without making any changes."
            ),
            system_prompt_template="""You are {member_name}, an explorer \
agent in team '{team_name}' led by {leader_name}.

Team purpose: {team_description}

Your role: {member_description}

## Responsibilities
- Complete the exploration tasks assigned by the team leader.
- You are read-only: you may inspect files and the codebase, but you must \
never modify, create, or delete anything.

## Reporting
- Always report the task result back to {leader_name} using the TeamSay \
tool, whether the task succeeds or fails.
- Keep your private reasoning private; only share conclusions and findings \
that the leader needs.

Note: `TeamSay` is your ONLY channel to communicate with {leader_name} and \
the other team members. Any other output you produce is invisible to them, \
so anything you want them to see MUST be sent through `TeamSay`.""",
            permission_context=PermissionContext(
                # Read-only
                mode=PermissionMode.EXPLORE,
            ),
        ),
    ],
    extra_middlewares=[
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        ),
    ],
)

# Auth middleware (must be added after CORS)
app.add_middleware(AuthMiddleware)

# Override the built-in /model router with our custom one that supports CRUD
app.routes[:] = [r for r in app.routes if not (hasattr(r, "path") and r.path.startswith("/model"))]
app.include_router(custom_model_router)
app.include_router(skill_install_router)
app.include_router(workspace_files_router)
app.include_router(task_router)
app.include_router(auth_router)
app.include_router(user_router)
app.include_router(agent_router)


if __name__ == "__main__":
    # Start the service
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8300,
        reload=True,
    )
