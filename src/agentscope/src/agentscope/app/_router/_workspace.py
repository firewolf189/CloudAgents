# -*- coding: utf-8 -*-
"""Workspace router — manage MCP clients and skills on a workspace."""
import os
import shutil
import tempfile
import zipfile

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field

from ..deps import (
    get_current_user_id,
    get_storage,
    get_workspace_manager,
)
from ..workspace_manager import WorkspaceManagerBase
from ..storage import StorageBase
from ...mcp import MCPClient
from ...skill import Skill
from ...workspace import WorkspaceBase

workspace_router = APIRouter(prefix="/workspace", tags=["workspace"])


class AddSkillRequest(BaseModel):
    """The request to add skill."""

    skill_path: str


class ToolInfo(BaseModel):
    """The tool info."""

    name: str
    description: str | None = None


class MCPClientStatus(MCPClient):
    """MCPClient enriched with live tool list and health status."""

    is_healthy: bool = False
    tools: list[ToolInfo] = Field(default_factory=list)


class ToolGroupInfo(BaseModel):
    """A tool group with its tools."""

    name: str
    description: str = ""
    tools: list[ToolInfo] = Field(default_factory=list)


class ToolsOverview(BaseModel):
    """All tool groups available to an agent session."""

    groups: list[ToolGroupInfo] = Field(default_factory=list)


async def _resolve_workspace(
    user_id: str,
    agent_id: str,
    session_id: str,
    storage: StorageBase,
    workspace_manager: WorkspaceManagerBase,
) -> WorkspaceBase:
    """Resolve the workspace for the given session, raising 404 if not
    found."""
    session_record = await storage.get_session(user_id, agent_id, session_id)
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


# ---------------------------------------------------------------------------
# MCP endpoints
# ---------------------------------------------------------------------------


@workspace_router.get("/mcp")
async def list_mcps(
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> list[MCPClientStatus]:
    """Return all MCP clients with live tool list and health status."""
    workspace = await _resolve_workspace(
        user_id,
        agent_id,
        session_id,
        storage,
        workspace_manager,
    )
    clients = await workspace.list_mcps()

    results = []
    for client in clients:
        base = client.model_dump()
        try:
            mcp_tools = await client.list_tools()
            tools = [
                ToolInfo(name=t.name, description=t.description)
                for t in mcp_tools
            ]
            results.append(
                MCPClientStatus(
                    **base,
                    is_healthy=True,
                    tools=tools,
                ),
            )
        except Exception:
            results.append(
                MCPClientStatus(
                    **base,
                    is_healthy=False,
                ),
            )

    return results


@workspace_router.post("/mcp", status_code=status.HTTP_201_CREATED)
async def add_mcp(
    mcp: MCPClient,
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> None:
    """Add an MCP client to the session's workspace."""
    workspace = await _resolve_workspace(
        user_id,
        agent_id,
        session_id,
        storage,
        workspace_manager,
    )
    await workspace.add_mcp(mcp)


@workspace_router.delete(
    "/mcp/{mcp_name}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_mcp(
    mcp_name: str,
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> None:
    """Remove an MCP client from the session's workspace by name."""
    workspace = await _resolve_workspace(
        user_id,
        agent_id,
        session_id,
        storage,
        workspace_manager,
    )
    await workspace.remove_mcp(mcp_name)


# ---------------------------------------------------------------------------
# Skill endpoints
# ---------------------------------------------------------------------------


@workspace_router.get("/skill")
async def list_skills(
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> list[Skill]:
    """Return all skills available in the session's workspace."""
    workspace = await _resolve_workspace(
        user_id,
        agent_id,
        session_id,
        storage,
        workspace_manager,
    )
    return await workspace.list_skills()


@workspace_router.post("/skill", status_code=status.HTTP_201_CREATED)
async def add_skill(
    body: AddSkillRequest,
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> None:
    """Add a skill to the session's workspace from the given path."""
    workspace = await _resolve_workspace(
        user_id,
        agent_id,
        session_id,
        storage,
        workspace_manager,
    )
    await workspace.add_skill(body.skill_path)


@workspace_router.post("/skill/upload", status_code=status.HTTP_201_CREATED)
async def upload_skill(
    file: UploadFile = File(...),
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    """Upload a zip file containing a skill and install it."""
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .zip files are accepted.",
        )

    workspace = await _resolve_workspace(
        user_id,
        agent_id,
        session_id,
        storage,
        workspace_manager,
    )

    tmp_dir = tempfile.mkdtemp(prefix="skill_upload_")
    try:
        zip_path = os.path.join(tmp_dir, file.filename)
        with open(zip_path, "wb") as f:
            content = await file.read()
            f.write(content)

        extract_dir = os.path.join(tmp_dir, "extracted")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)

        # Find the skill directory (contains SKILL.md)
        skill_dir = None
        for root, _dirs, files in os.walk(extract_dir):
            if "SKILL.md" in files:
                skill_dir = root
                break

        if skill_dir is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No SKILL.md found in the uploaded zip.",
            )

        await workspace.add_skill(skill_dir)
        return {"status": "ok", "skill_path": skill_dir}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@workspace_router.delete(
    "/skill/{skill_name}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_skill(
    skill_name: str,
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> None:
    """Remove a skill from the session's workspace by name."""
    workspace = await _resolve_workspace(
        user_id,
        agent_id,
        session_id,
        storage,
        workspace_manager,
    )
    await workspace.remove_skill(skill_name)


# ---------------------------------------------------------------------------
# Tools overview endpoint
# ---------------------------------------------------------------------------

_WIKI_TOOLS = [
    ToolInfo(
        name="WikiList",
        description="List all pages in the wiki.",
    ),
    ToolInfo(
        name="WikiRead",
        description="Read a wiki page by path.",
    ),
    ToolInfo(
        name="WikiWrite",
        description="Create or update a wiki page.",
    ),
    ToolInfo(
        name="WikiSearch",
        description="Search wiki with multi-keyword support, "
        "returns top matches with full content.",
    ),
    ToolInfo(
        name="WikiListRaw",
        description="List raw source documents.",
    ),
    ToolInfo(
        name="WikiReadRaw",
        description="Read a raw source document.",
    ),
    ToolInfo(
        name="WikiLog",
        description="Read wiki operation log — recent ingests, "
        "queries, lints, and fixes.",
    ),
    ToolInfo(
        name="WikiSaveRaw",
        description="Save a new document to raw/ directory.",
    ),
    ToolInfo(
        name="WikiIngest",
        description="Ingest a raw document into wiki pages via LLM.",
    ),
    ToolInfo(
        name="WikiLint",
        description="Run a health check on the wiki.",
    ),
]

_PLANNING_TOOLS = [
    ToolInfo(name="TaskCreate", description="Create a task."),
    ToolInfo(name="TaskList", description="List all tasks."),
    ToolInfo(name="TaskGet", description="Get a task by ID."),
    ToolInfo(name="TaskUpdate", description="Update a task."),
]

_SCHEDULE_TOOLS = [
    ToolInfo(
        name="ScheduleCreate",
        description="Create a cron schedule.",
    ),
    ToolInfo(
        name="ScheduleList",
        description="List all schedules.",
    ),
    ToolInfo(
        name="ScheduleView",
        description="View a schedule's details.",
    ),
    ToolInfo(
        name="ScheduleDelete",
        description="Delete a schedule.",
    ),
]

_TEAM_TOOLS = [
    ToolInfo(
        name="TeamCreate",
        description="Create a multi-agent team.",
    ),
    ToolInfo(
        name="AgentCreate",
        description="Add an agent to the team.",
    ),
    ToolInfo(
        name="TeamSay",
        description="Send a message within the team.",
    ),
    ToolInfo(
        name="TeamDelete",
        description="Dissolve the team.",
    ),
]


@workspace_router.get("/tools")
async def list_tools(
    agent_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    workspace_manager: WorkspaceManagerBase = Depends(
        get_workspace_manager,
    ),
) -> ToolsOverview:
    """Return all tool groups available to this agent session."""
    workspace = await _resolve_workspace(
        user_id,
        agent_id,
        session_id,
        storage,
        workspace_manager,
    )

    groups: list[ToolGroupInfo] = []

    def _short_desc(desc: str) -> str:
        """Extract the first sentence from a tool description."""
        line = desc.strip().split("\n")[0].strip()
        for sep in (". ", "。"):
            idx = line.find(sep)
            if idx != -1:
                return line[: idx + 1]
        return line[:120]

    # 1. Basic group — workspace built-in tools + planning tools
    ws_tools = await workspace.list_tools()
    basic_tools = [
        ToolInfo(name=t.name, description=_short_desc(t.description))
        for t in ws_tools
    ] + _PLANNING_TOOLS
    groups.append(ToolGroupInfo(
        name="basic",
        description="Built-in workspace tools and planning tools.",
        tools=basic_tools,
    ))

    # 2. Wiki tools — available to all agents
    groups.append(ToolGroupInfo(
        name="wiki_tools",
        description=(
            "Tools for reading and writing this agent's "
            "Wiki knowledge base."
        ),
        tools=_WIKI_TOOLS,
    ))

    # 3. Schedule tools — if session has a model config
    session_record = await storage.get_session(
        user_id, agent_id, session_id,
    )
    if (
        session_record is not None
        and session_record.config.chat_model_config is not None
    ):
        groups.append(ToolGroupInfo(
            name="schedule_tools",
            description="Tools for managing cron schedules.",
            tools=_SCHEDULE_TOOLS,
        ))

    # 4. Team tools
    groups.append(ToolGroupInfo(
        name="team_tools",
        description="Tools for creating and managing multi-agent teams.",
        tools=_TEAM_TOOLS,
    ))

    return ToolsOverview(groups=groups)

