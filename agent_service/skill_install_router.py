# -*- coding: utf-8 -*-
"""Skill install router — install skills from URL/registry via npx skills."""
import asyncio
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field


class InstallSkillRequest(BaseModel):
    source: str = Field(
        description="Git URL or shorthand, e.g. "
        "https://github.com/anthropics/claude-code-skills "
        "or anthropics/claude-code-skills",
    )
    skill: str | None = Field(
        default=None,
        description="Specific skill name to install (--skill flag). "
        "If omitted, all skills in the repo are installed.",
    )


class InstallSkillResponse(BaseModel):
    success: bool
    output: str
    error: str | None = None


async def _get_user_id(request: Request) -> str:
    user_id = request.headers.get("X-User-ID", "")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-User-ID header is required.",
        )
    return user_id


async def _resolve_workspace(
    request: Request,
    user_id: str,
    agent_id: str,
    session_id: str,
) -> Any:
    storage = request.app.state.storage
    workspace_manager = request.app.state.workspace_manager
    session_record = await storage.get_session(
        user_id,
        agent_id,
        session_id,
    )
    if session_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id!r} not found.",
        )
    return await workspace_manager.get_workspace(
        user_id,
        agent_id,
        session_id,
        session_record.config.workspace_id,
    )


skill_install_router = APIRouter(
    prefix="/workspace",
    tags=["workspace"],
)


@skill_install_router.post(
    "/skill/install",
    response_model=InstallSkillResponse,
    summary="Install a skill from a URL or registry",
)
async def install_skill(
    body: InstallSkillRequest,
    agent_id: str = Query(...),
    session_id: str = Query(...),
    request: Request = None,
    user_id: str = Depends(_get_user_id),
) -> InstallSkillResponse:
    workspace = await _resolve_workspace(
        request,
        user_id,
        agent_id,
        session_id,
    )

    cmd = ["npx", "-y", "skills", "add", body.source, "-y", "--copy"]
    if body.skill:
        cmd.extend(["--skill", body.skill])

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=workspace.workdir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "CI": "1"},
        )
        stdout, _ = await asyncio.wait_for(
            proc.communicate(),
            timeout=120,
        )
        output = stdout.decode(errors="replace")

        if proc.returncode != 0:
            return InstallSkillResponse(
                success=False,
                output=output,
                error=f"Process exited with code {proc.returncode}",
            )

        skills_dir = os.path.join(
            workspace.workdir,
            ".claude",
            "skills",
        )
        if os.path.isdir(skills_dir):
            for entry in os.listdir(skills_dir):
                skill_path = os.path.join(skills_dir, entry)
                skill_md = os.path.join(skill_path, "SKILL.md")
                if os.path.isdir(skill_path) and os.path.isfile(skill_md):
                    try:
                        await workspace.add_skill(skill_path)
                    except (ValueError, Exception):
                        pass

        return InstallSkillResponse(success=True, output=output)
    except asyncio.TimeoutError:
        return InstallSkillResponse(
            success=False,
            output="",
            error="Installation timed out after 120 seconds.",
        )
    except Exception as e:
        return InstallSkillResponse(
            success=False,
            output="",
            error=str(e),
        )
