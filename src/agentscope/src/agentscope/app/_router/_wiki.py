# -*- coding: utf-8 -*-
"""Wiki router — per-agent knowledge base backed by the file system."""
import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..deps import get_current_user_id, get_storage, get_workspace_manager
from ..workspace_manager import WorkspaceManagerBase
from ..storage import StorageBase
from .._service._model import get_model
from .._service._wiki import (
    WikiService,
    RawDocInfo,
    WikiPageInfo,
    IngestResult,
    QueryResult,
    LintResult,
    FixLinksResult,
    GraphData,
)

wiki_router = APIRouter(prefix="/wiki", tags=["wiki"])


def _wiki_dir(workspace_manager: WorkspaceManagerBase, agent_id: str) -> str:
    """Resolve the wiki directory for an agent."""
    basedir = getattr(workspace_manager, "_basedir", None)
    if basedir is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Wiki requires a local workspace manager.",
        )
    return os.path.join(basedir, agent_id, "wiki")


# ------------------------------------------------------------------
# Pages
# ------------------------------------------------------------------


@wiki_router.get("/{agent_id}/pages", summary="List wiki pages")
async def list_pages(
    agent_id: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> list[WikiPageInfo]:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()
    return svc.list_pages()


@wiki_router.get(
    "/{agent_id}/pages/{path:path}",
    summary="Read a wiki page",
)
async def get_page(
    agent_id: str,
    path: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    svc = WikiService(_wiki_dir(wm, agent_id))
    try:
        content = svc.read_page(path)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Wiki page '{path}' not found.",
        )
    return {"path": path, "content": content}


class SavePageRequest(BaseModel):
    path: str = Field(description="Relative path, e.g. concepts/foo.md")
    content: str = Field(description="Full markdown content with frontmatter")


@wiki_router.post(
    "/{agent_id}/pages",
    status_code=status.HTTP_201_CREATED,
    summary="Create a wiki page",
)
async def create_page(
    agent_id: str,
    body: SavePageRequest,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()
    svc.save_page(body.path, body.content)
    return {"path": body.path}


@wiki_router.put(
    "/{agent_id}/pages/{path:path}",
    summary="Update a wiki page",
)
async def update_page(
    agent_id: str,
    path: str,
    body: SavePageRequest,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.save_page(path, body.content)
    return {"path": path}


@wiki_router.delete(
    "/{agent_id}/pages/{path:path}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a wiki page",
)
async def delete_page(
    agent_id: str,
    path: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> None:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.delete_page(path)


# ------------------------------------------------------------------
# Directories (wiki/ subdirectories)
# ------------------------------------------------------------------


class CreateDirRequest(BaseModel):
    path: str = Field(description="Directory path relative to wiki/, e.g. 'topics/subtopic'")


@wiki_router.post(
    "/{agent_id}/dir",
    status_code=status.HTTP_201_CREATED,
    summary="Create a wiki subdirectory",
)
async def create_dir(
    agent_id: str,
    body: CreateDirRequest,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()
    svc.create_dir(body.path)
    return {"path": body.path}


@wiki_router.delete(
    "/{agent_id}/dir/{path:path}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a wiki subdirectory",
)
async def delete_dir(
    agent_id: str,
    path: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> None:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.delete_dir(path)


# ------------------------------------------------------------------
# Raw documents
# ------------------------------------------------------------------


@wiki_router.get("/{agent_id}/raw", summary="List raw documents")
async def list_raws(
    agent_id: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> list[RawDocInfo]:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()
    return svc.list_raws()


class UploadRawRequest(BaseModel):
    filename: str
    content: str


@wiki_router.post(
    "/{agent_id}/raw",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a raw document",
)
async def upload_raw(
    agent_id: str,
    body: UploadRawRequest,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> RawDocInfo:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()
    svc.save_raw(body.filename, body.content)
    return RawDocInfo(filename=body.filename, status="pending")


@wiki_router.get(
    "/{agent_id}/raw/{filename}",
    summary="Read a raw document",
)
async def get_raw(
    agent_id: str,
    filename: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    svc = WikiService(_wiki_dir(wm, agent_id))
    try:
        content = svc.read_raw(filename)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Raw document '{filename}' not found.",
        )
    return {"filename": filename, "content": content}


class UpdateRawRequest(BaseModel):
    content: str


@wiki_router.put(
    "/{agent_id}/raw/{filename}",
    summary="Update a raw document",
)
async def update_raw(
    agent_id: str,
    filename: str,
    body: UpdateRawRequest,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.save_raw(filename, body.content)
    return {"filename": filename}


@wiki_router.delete(
    "/{agent_id}/raw/{filename}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a raw document",
)
async def delete_raw(
    agent_id: str,
    filename: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> None:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.delete_raw(filename)


# ------------------------------------------------------------------
# Index & Log
# ------------------------------------------------------------------


@wiki_router.get("/{agent_id}/index", summary="Read wiki index")
async def get_index(
    agent_id: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()
    return {"content": svc.read_index()}


@wiki_router.post(
    "/{agent_id}/rebuild-index",
    summary="Rebuild index.md from all wiki pages",
)
async def rebuild_index(
    agent_id: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    svc = WikiService(_wiki_dir(wm, agent_id))
    content = svc.rebuild_index()
    return {"content": content}


@wiki_router.get("/{agent_id}/log", summary="Read wiki log")
async def get_log(
    agent_id: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> dict:
    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()
    content = svc.read_log()
    entries = _parse_log_entries(content)
    return {"content": content, "entries": entries}


def _parse_log_entries(content: str) -> list[dict]:
    """Parse log.md into structured entries for the timeline UI.

    Returns entries sorted newest-first by timestamp.
    """
    import re
    entries = []
    parts = re.split(r"(?=^## \[)", content, flags=re.MULTILINE)
    for part in parts:
        m = re.match(
            r"^## \[([^\]]+)\]\s*(\S+)\s*\|\s*(.+)",
            part.strip(),
        )
        if not m:
            continue
        timestamp, operation, source = (
            m.group(1).strip(),
            m.group(2).strip(),
            m.group(3).strip(),
        )
        details = []
        for line in part.strip().splitlines()[1:]:
            line = line.strip()
            if line.startswith("- "):
                details.append(line[2:])
        entries.append({
            "timestamp": timestamp,
            "operation": operation,
            "source": source,
            "details": details,
        })
    entries.sort(key=lambda e: e["timestamp"], reverse=True)
    return entries


# ------------------------------------------------------------------
# Config (still stored in Redis — it's metadata, not content)
# ------------------------------------------------------------------

from ..storage._model._wiki import WikiConfig
from ._schema._wiki import UpdateWikiConfigRequest


@wiki_router.get("/{agent_id}/config", summary="Get wiki configuration")
async def get_config(
    agent_id: str,
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
) -> WikiConfig:
    return await storage.get_wiki_config(user_id)


@wiki_router.put("/{agent_id}/config", summary="Update wiki configuration")
async def update_config(
    agent_id: str,
    body: UpdateWikiConfigRequest,
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
) -> WikiConfig:
    config = WikiConfig(
        authorized_agents=body.authorized_agents,
        chat_model_config=body.chat_model_config,
    )
    await storage.upsert_wiki_config(user_id, config)
    return config


# ------------------------------------------------------------------
# Ingest
# ------------------------------------------------------------------


@wiki_router.post(
    "/{agent_id}/ingest/{filename}",
    summary="Ingest a raw document via LLM",
)
async def ingest_raw(
    agent_id: str,
    filename: str,
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> IngestResult:
    wiki_config = await storage.get_wiki_config(user_id)
    if wiki_config.chat_model_config is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No ingest model configured. Set a model in Wiki "
            "Settings first.",
        )

    model = await get_model(
        user_id,
        wiki_config.chat_model_config,
        storage,
    )

    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()

    svc.start_ingest(filename)
    try:
        return await svc.ingest(filename, model)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Raw document '{filename}' not found.",
        )
    finally:
        svc.finish_ingest(filename)


# ------------------------------------------------------------------
# Query
# ------------------------------------------------------------------


class QueryRequest(BaseModel):
    question: str = Field(description="Question to ask the wiki.")


@wiki_router.post(
    "/{agent_id}/ingest-all",
    summary="Ingest all pending raw documents",
)
async def ingest_all(
    agent_id: str,
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> list[IngestResult]:
    wiki_config = await storage.get_wiki_config(user_id)
    if wiki_config.chat_model_config is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No ingest model configured. Set a model in Wiki "
            "Settings first.",
        )

    model = await get_model(
        user_id,
        wiki_config.chat_model_config,
        storage,
    )

    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()
    raws = svc.list_raws()
    pending = [r for r in raws if r.status != "ingested"]
    results = []
    for raw in pending:
        svc.start_ingest(raw.filename)
        try:
            result = await svc.ingest(raw.filename, model)
            results.append(result)
        except FileNotFoundError:
            continue
        finally:
            svc.finish_ingest(raw.filename)
    return results


@wiki_router.get(
    "/{agent_id}/ingest-status",
    summary="Get currently ingesting filenames",
)
async def ingest_status(
    agent_id: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> list[str]:
    svc = WikiService(_wiki_dir(wm, agent_id))
    return svc.get_ingest_status()


@wiki_router.post(
    "/{agent_id}/query",
    summary="Query the wiki knowledge base",
)
async def query_wiki(
    agent_id: str,
    body: QueryRequest,
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> QueryResult:
    wiki_config = await storage.get_wiki_config(user_id)
    if wiki_config.chat_model_config is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No model configured. Set a model in Wiki "
            "Settings first.",
        )

    model = await get_model(
        user_id,
        wiki_config.chat_model_config,
        storage,
    )

    svc = WikiService(_wiki_dir(wm, agent_id))
    return await svc.query(body.question, model)


# ------------------------------------------------------------------
# Lint
# ------------------------------------------------------------------


@wiki_router.get(
    "/{agent_id}/lint",
    summary="Run wiki health check",
)
async def lint_wiki(
    agent_id: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> LintResult:
    svc = WikiService(_wiki_dir(wm, agent_id))
    return svc.lint()


# ------------------------------------------------------------------
# Graph
# ------------------------------------------------------------------


@wiki_router.get(
    "/{agent_id}/graph",
    summary="Get wiki knowledge graph data",
)
async def graph_wiki(
    agent_id: str,
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> GraphData:
    svc = WikiService(_wiki_dir(wm, agent_id))
    return svc.graph()


# ------------------------------------------------------------------
# Fix broken links
# ------------------------------------------------------------------


@wiki_router.post(
    "/{agent_id}/fix-links",
    summary="Auto-fix all lint issues (broken links, orphans, no sources)",
)
async def fix_broken_links(
    agent_id: str,
    user_id: str = Depends(get_current_user_id),
    storage: StorageBase = Depends(get_storage),
    wm: WorkspaceManagerBase = Depends(get_workspace_manager),
) -> FixLinksResult:
    wiki_config = await storage.get_wiki_config(user_id)
    if wiki_config.chat_model_config is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No model configured. Set a model in Wiki "
            "Settings first.",
        )

    model = await get_model(
        user_id,
        wiki_config.chat_model_config,
        storage,
    )

    svc = WikiService(_wiki_dir(wm, agent_id))
    svc.init()
    return await svc.fix(model)
