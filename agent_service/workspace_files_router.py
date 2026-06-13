# -*- coding: utf-8 -*-
"""Workspace file-browsing router — list files and directories."""
import io
import mimetypes
import os
import zipfile
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

workspace_files_router = APIRouter(
    prefix="/workspace", tags=["workspace"],
)


class FileEntry(BaseModel):
    name: str
    type: str  # "file" | "directory"
    size: int
    modified: str


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


async def _get_workspace_manager(request: Request) -> Any:
    return request.app.state.workspace_manager


async def _resolve_workdir(
    user_id: str,
    agent_id: str,
    session_id: str,
    storage: Any,
    workspace_manager: Any,
) -> str:
    session_record = await storage.get_session(user_id, agent_id, session_id)
    if session_record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id!r} not found.",
        )
    workspace = await workspace_manager.get_workspace(
        user_id,
        agent_id,
        session_id,
        session_record.config.workspace_id,
    )
    return workspace.workdir


@workspace_files_router.get("/files")
async def list_files(
    agent_id: str = Query(...),
    session_id: str = Query(...),
    path: str = Query(""),
    user_id: str = Depends(_get_user_id),
    storage: Any = Depends(_get_storage),
    workspace_manager: Any = Depends(_get_workspace_manager),
) -> list[FileEntry]:
    """List files and directories under the given workspace path."""
    workdir = await _resolve_workdir(
        user_id, agent_id, session_id, storage, workspace_manager,
    )

    if ".." in path.split("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal is not allowed.",
        )

    target = os.path.realpath(os.path.join(workdir, path))
    workdir_real = os.path.realpath(workdir)
    if not target.startswith(workdir_real):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path is outside the workspace.",
        )

    if not os.path.isdir(target):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Directory not found: {path!r}",
        )

    entries: list[FileEntry] = []
    try:
        items = os.listdir(target)
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied.",
        )

    for name in sorted(items):
        if name.startswith("."):
            continue
        if name == "skills-lock.json":
            continue

        full = os.path.join(target, name)
        try:
            st = os.stat(full)
        except OSError:
            continue

        entry_type = "directory" if os.path.isdir(full) else "file"
        modified = datetime.fromtimestamp(
            st.st_mtime, tz=timezone.utc,
        ).isoformat()
        entries.append(FileEntry(
            name=name,
            type=entry_type,
            size=st.st_size,
            modified=modified,
        ))

    entries.sort(key=lambda e: (0 if e.type == "directory" else 1, e.name))
    return entries


MAX_FILE_SIZE = 1 * 1024 * 1024  # 1 MB


class FileContent(BaseModel):
    content: str
    name: str
    size: int


@workspace_files_router.get("/file-content")
async def read_file(
    agent_id: str = Query(...),
    session_id: str = Query(...),
    path: str = Query(...),
    user_id: str = Depends(_get_user_id),
    storage: Any = Depends(_get_storage),
    workspace_manager: Any = Depends(_get_workspace_manager),
) -> FileContent:
    """Read file content for preview."""
    workdir = await _resolve_workdir(
        user_id, agent_id, session_id, storage, workspace_manager,
    )

    if ".." in path.split("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal is not allowed.",
        )

    target = os.path.realpath(os.path.join(workdir, path))
    workdir_real = os.path.realpath(workdir)
    if not target.startswith(workdir_real):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path is outside the workspace.",
        )

    if not os.path.isfile(target):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {path!r}",
        )

    file_size = os.path.getsize(target)
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large for preview (max 1 MB).",
        )

    try:
        with open(target, "rb") as f:
            head = f.read(8192)
            if b"\x00" in head:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Binary file cannot be previewed.",
                )
            f.seek(0)
            content = f.read().decode("utf-8", errors="replace")
    except HTTPException:
        raise
    except OSError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to read file.",
        )

    return FileContent(
        content=content,
        name=os.path.basename(target),
        size=file_size,
    )


class SaveFileRequest(BaseModel):
    content: str


@workspace_files_router.post("/file-content")
async def save_file(
    body: SaveFileRequest,
    agent_id: str = Query(...),
    session_id: str = Query(...),
    path: str = Query(...),
    user_id: str = Depends(_get_user_id),
    storage: Any = Depends(_get_storage),
    workspace_manager: Any = Depends(_get_workspace_manager),
) -> dict:
    """Save file content."""
    workdir = await _resolve_workdir(
        user_id, agent_id, session_id, storage, workspace_manager,
    )

    if ".." in path.split("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal is not allowed.",
        )

    target = os.path.realpath(os.path.join(workdir, path))
    workdir_real = os.path.realpath(workdir)
    if not target.startswith(workdir_real):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path is outside the workspace.",
        )

    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(body.content)
    except OSError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save file.",
        )

    return {"status": "ok"}


MAX_RAW_SIZE = 10 * 1024 * 1024  # 10 MB


@workspace_files_router.get("/file-raw")
async def raw_file(
    agent_id: str = Query(...),
    session_id: str = Query(...),
    path: str = Query(...),
    download: bool = Query(False),
    user_id: str = Depends(_get_user_id),
    storage: Any = Depends(_get_storage),
    workspace_manager: Any = Depends(_get_workspace_manager),
) -> FileResponse:
    """Serve a workspace file with its native MIME type (images, etc.)."""
    workdir = await _resolve_workdir(
        user_id, agent_id, session_id, storage, workspace_manager,
    )

    if ".." in path.split("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal is not allowed.",
        )

    target = os.path.realpath(os.path.join(workdir, path))
    workdir_real = os.path.realpath(workdir)
    if not target.startswith(workdir_real):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path is outside the workspace.",
        )

    if not os.path.isfile(target):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {path!r}",
        )

    if os.path.getsize(target) > MAX_RAW_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large (max 10 MB).",
        )

    media_type = mimetypes.guess_type(target)[0] or "application/octet-stream"
    filename = os.path.basename(target)
    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return FileResponse(target, media_type=media_type, headers=headers)


MAX_DIR_SIZE = 50 * 1024 * 1024  # 50 MB


@workspace_files_router.get("/download-dir")
async def download_dir(
    agent_id: str = Query(...),
    session_id: str = Query(...),
    path: str = Query(""),
    user_id: str = Depends(_get_user_id),
    storage: Any = Depends(_get_storage),
    workspace_manager: Any = Depends(_get_workspace_manager),
) -> StreamingResponse:
    """Download a workspace directory as a zip archive."""
    workdir = await _resolve_workdir(
        user_id, agent_id, session_id, storage, workspace_manager,
    )

    if ".." in path.split("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal is not allowed.",
        )

    target = os.path.realpath(os.path.join(workdir, path))
    workdir_real = os.path.realpath(workdir)
    if not target.startswith(workdir_real):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path is outside the workspace.",
        )

    if not os.path.isdir(target):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Directory not found: {path!r}",
        )

    total_size = 0
    for dirpath, _dirnames, filenames in os.walk(target):
        for f in filenames:
            total_size += os.path.getsize(os.path.join(dirpath, f))
    if total_size > MAX_DIR_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Directory too large to download (max 50 MB).",
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _dirnames, filenames in os.walk(target):
            for f in filenames:
                full = os.path.join(dirpath, f)
                arcname = os.path.relpath(full, target)
                zf.write(full, arcname)
    buf.seek(0)

    dirname = os.path.basename(target) or "workspace"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{dirname}.zip"',
        },
    )
