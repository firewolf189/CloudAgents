# -*- coding: utf-8 -*-
"""Wiki tools for agent access to the knowledge base.

Each tool operates on the agent's wiki directory (file system),
following the llm-wiki architecture:
- **raw/** — immutable source documents uploaded by the user.
- **wiki/** — LLM-generated pages organized by category.
"""
import os
from typing import Any

from ...tool._base import ToolBase
from ...tool._response import ToolChunk
from ...message import TextBlock, ToolResultState
from ...permission import (
    PermissionContext,
    PermissionDecision,
    PermissionBehavior,
)
from .._service._wiki import WikiService


class _WikiToolBase(ToolBase):
    """Shared base for wiki tools — auto-allows all invocations."""

    async def check_permissions(
        self,
        tool_input: dict[str, Any],
        context: PermissionContext,
    ) -> PermissionDecision:
        return PermissionDecision(
            behavior=PermissionBehavior.ALLOW,
            message=f"{self.name} is always allowed.",
        )


# ------------------------------------------------------------------
# Raw document tools
# ------------------------------------------------------------------


class WikiListRaw(_WikiToolBase):
    """List raw source documents."""

    name: str = "WikiListRaw"
    description: str = (
        "List all raw source documents uploaded by the user. "
        "Shows filename and whether the doc has been ingested."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {},
    }
    is_read_only: bool = True
    is_concurrency_safe: bool = True

    def __init__(self, wiki_dir: str) -> None:
        self._svc = WikiService(wiki_dir)

    async def __call__(self) -> ToolChunk:
        raws = self._svc.list_raws()
        if not raws:
            return ToolChunk(
                content=[TextBlock(text="No raw documents uploaded.")],
                state=ToolResultState.SUCCESS,
            )
        lines = []
        for r in raws:
            st = r.status
            lines.append(f"- [{st}] **{r.filename}**")
        return ToolChunk(
            content=[TextBlock(text="\n".join(lines))],
            state=ToolResultState.SUCCESS,
        )


class WikiReadRaw(_WikiToolBase):
    """Read a raw source document."""

    name: str = "WikiReadRaw"
    description: str = (
        "Read the full content of a raw source document by filename."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": "The raw document filename.",
            },
        },
        "required": ["filename"],
    }
    is_read_only: bool = True
    is_concurrency_safe: bool = True

    def __init__(self, wiki_dir: str) -> None:
        self._svc = WikiService(wiki_dir)

    async def __call__(self, filename: str) -> ToolChunk:
        try:
            content = self._svc.read_raw(filename)
        except FileNotFoundError:
            return ToolChunk(
                content=[TextBlock(
                    text=f"Raw document '{filename}' not found.",
                )],
                state=ToolResultState.ERROR,
            )
        return ToolChunk(
            content=[TextBlock(text=f"# {filename}\n\n{content}")],
            state=ToolResultState.SUCCESS,
        )


# ------------------------------------------------------------------
# Wiki page tools
# ------------------------------------------------------------------


class WikiList(_WikiToolBase):
    """List all wiki pages."""

    name: str = "WikiList"
    description: str = (
        "List all pages in the wiki. Returns title, path, category, "
        "and tags for each page."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": "Filter by category: concepts, entities, "
                "topics, analysis, journal.",
            },
        },
    }
    is_read_only: bool = True
    is_concurrency_safe: bool = True

    def __init__(self, wiki_dir: str) -> None:
        self._svc = WikiService(wiki_dir)

    async def __call__(self, category: str = "") -> ToolChunk:
        pages = self._svc.list_pages()
        if category:
            pages = [p for p in pages if p.category == category]
        if not pages:
            return ToolChunk(
                content=[TextBlock(text="No wiki pages found.")],
                state=ToolResultState.SUCCESS,
            )
        grouped: dict[str, list] = {}
        for p in pages:
            grouped.setdefault(p.category or "other", []).append(p)

        lines = []
        for cat, cat_pages in sorted(grouped.items()):
            lines.append(f"\n## {cat.title()}")
            for p in cat_pages:
                tags = f" [{', '.join(p.tags)}]" if p.tags else ""
                lines.append(f"- **{p.title}** ({p.path}){tags}")
        return ToolChunk(
            content=[TextBlock(text="\n".join(lines))],
            state=ToolResultState.SUCCESS,
        )


class WikiRead(_WikiToolBase):
    """Read a wiki page."""

    name: str = "WikiRead"
    description: str = (
        "Read the full markdown content of a wiki page by path "
        "(e.g. 'concepts/foo.md')."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Relative path of the page, "
                "e.g. 'concepts/foo.md'.",
            },
        },
        "required": ["path"],
    }
    is_read_only: bool = True
    is_concurrency_safe: bool = True

    def __init__(self, wiki_dir: str) -> None:
        self._svc = WikiService(wiki_dir)

    async def __call__(self, path: str) -> ToolChunk:
        try:
            content = self._svc.read_page(path)
        except FileNotFoundError:
            return ToolChunk(
                content=[TextBlock(
                    text=f"Wiki page '{path}' not found.",
                )],
                state=ToolResultState.ERROR,
            )
        return ToolChunk(
            content=[TextBlock(text=content)],
            state=ToolResultState.SUCCESS,
        )


class WikiWrite(_WikiToolBase):
    """Create or update a wiki page."""

    name: str = "WikiWrite"
    description: str = (
        "Create a new wiki page or update an existing one. "
        "Provide the full markdown content including frontmatter. "
        "Use [[wikilinks]] for cross-references."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Relative path, e.g. 'concepts/foo.md'.",
            },
            "content": {
                "type": "string",
                "description": "Full markdown content with frontmatter.",
            },
        },
        "required": ["path", "content"],
    }
    is_read_only: bool = False
    is_concurrency_safe: bool = False

    def __init__(self, wiki_dir: str) -> None:
        self._svc = WikiService(wiki_dir)

    async def __call__(self, path: str, content: str) -> ToolChunk:
        self._svc.save_page(path, content)
        return ToolChunk(
            content=[TextBlock(text=f"Saved wiki page '{path}'.")],
            state=ToolResultState.SUCCESS,
        )


class WikiSearch(_WikiToolBase):
    """Search wiki pages with multi-keyword support and content snippets."""

    name: str = "WikiSearch"
    description: str = (
        "Search the wiki knowledge base. Supports multiple keywords "
        "(space-separated, all must match). Returns matching pages "
        "with relevance scores and content snippets. Automatically "
        "includes the full content of the top results so you don't "
        "need to call WikiRead separately for the best matches."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "Search query. Multiple keywords separated by "
                    "spaces — all must match. Example: '旅行 保险'"
                ),
            },
            "top_k": {
                "type": "integer",
                "description": (
                    "Number of top results to return full content "
                    "for. Default 3, max 5."
                ),
                "default": 3,
            },
        },
        "required": ["query"],
    }
    is_read_only: bool = True
    is_concurrency_safe: bool = True

    def __init__(self, wiki_dir: str) -> None:
        self._svc = WikiService(wiki_dir)

    @staticmethod
    def _extract_snippet(
        content: str,
        keywords: list[str],
        window: int = 80,
    ) -> str:
        """Extract a snippet around the first keyword match."""
        lower = content.lower()
        best_pos = len(content)
        for kw in keywords:
            pos = lower.find(kw)
            if 0 <= pos < best_pos:
                best_pos = pos
        if best_pos >= len(content):
            return content[:160].strip() + "…"
        start = max(0, best_pos - window)
        end = min(len(content), best_pos + len(keywords[0]) + window)
        snippet = content[start:end].replace("\n", " ").strip()
        if start > 0:
            snippet = "…" + snippet
        if end < len(content):
            snippet = snippet + "…"
        return snippet

    async def __call__(
        self,
        query: str,
        top_k: int = 3,
    ) -> ToolChunk:
        top_k = max(1, min(top_k, 5))
        keywords = [k.lower() for k in query.split() if k.strip()]
        if not keywords:
            return ToolChunk(
                content=[TextBlock(text="Empty query.")],
                state=ToolResultState.ERROR,
            )

        pages = self._svc.list_pages()

        scored: list[tuple[int, Any, str]] = []
        for p in pages:
            score = 0
            content = ""
            title_lower = p.title.lower()
            tags_lower = " ".join(p.tags).lower()

            # Check if all keywords match somewhere
            all_match = True
            for kw in keywords:
                in_title = kw in title_lower
                in_tags = kw in tags_lower
                if in_title:
                    score += 10
                if in_tags:
                    score += 5
                if not in_title and not in_tags:
                    try:
                        if not content:
                            content = self._svc.read_page(p.path)
                        if kw not in content.lower():
                            all_match = False
                            break
                        score += 1
                    except FileNotFoundError:
                        all_match = False
                        break

            if all_match and score > 0:
                if not content:
                    try:
                        content = self._svc.read_page(p.path)
                    except FileNotFoundError:
                        content = ""
                scored.append((score, p, content))

        scored.sort(key=lambda x: -x[0])

        if not scored:
            return ToolChunk(
                content=[TextBlock(
                    text=f"No wiki pages matching '{query}'.",
                )],
                state=ToolResultState.SUCCESS,
            )

        parts = [
            f"Found {len(scored)} page(s) matching '{query}'.\n",
        ]

        # Top results — include full content
        top = scored[:top_k]
        rest = scored[top_k:]

        for rank, (score, p, content) in enumerate(top, 1):
            tags = f" [{', '.join(p.tags)}]" if p.tags else ""
            parts.append(
                f"---\n"
                f"### {rank}. {p.title} ({p.path}){tags}\n\n"
                f"{content}\n"
            )

        # Remaining results — snippet only
        if rest:
            parts.append("---\n### Other matches:\n")
            for score, p, content in rest:
                snippet = self._extract_snippet(content, keywords)
                parts.append(
                    f"- **{p.title}** ({p.path}) — {snippet}"
                )

        return ToolChunk(
            content=[TextBlock(text="\n".join(parts))],
            state=ToolResultState.SUCCESS,
        )


class WikiLog(_WikiToolBase):
    """Read the wiki operation log."""

    name: str = "WikiLog"
    description: str = (
        "Read the wiki/knowledge base operation log (log.md). "
        "Shows recent ingest, query, lint, and fix operations "
        "with timestamps. Use this when the user asks about wiki "
        "activity, recent changes, or operation history."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "last_n": {
                "type": "integer",
                "description": (
                    "Number of most recent log entries to return. "
                    "Default 10."
                ),
                "default": 10,
            },
        },
    }
    is_read_only: bool = True
    is_concurrency_safe: bool = True

    def __init__(self, wiki_dir: str) -> None:
        self._svc = WikiService(wiki_dir)

    async def __call__(self, last_n: int = 10) -> ToolChunk:
        try:
            content = self._svc.read_log()
        except FileNotFoundError:
            return ToolChunk(
                content=[TextBlock(text="No wiki log found.")],
                state=ToolResultState.SUCCESS,
            )
        if not content.strip():
            return ToolChunk(
                content=[TextBlock(text="Wiki log is empty.")],
                state=ToolResultState.SUCCESS,
            )

        # Split by "## [" entries and take last N
        entries = []
        current: list[str] = []
        for line in content.split("\n"):
            if line.startswith("## [") and current:
                entries.append("\n".join(current))
                current = [line]
            else:
                current.append(line)
        if current:
            entries.append("\n".join(current))

        # Filter out header lines (before first ## entry)
        entries = [e for e in entries if e.strip().startswith("## [")]

        recent = entries[:last_n]
        if not recent:
            return ToolChunk(
                content=[TextBlock(text="Wiki log is empty.")],
                state=ToolResultState.SUCCESS,
            )

        header = f"Showing {len(recent)} of {len(entries)} log entries:\n\n"
        return ToolChunk(
            content=[TextBlock(text=header + "\n\n".join(recent))],
            state=ToolResultState.SUCCESS,
        )


class WikiSaveRaw(_WikiToolBase):
    """Save a document to the raw/ directory."""

    name: str = "WikiSaveRaw"
    description: str = (
        "Save a new document to the wiki's raw/ directory. "
        "Use this to add source material that can later be "
        "ingested into wiki pages via WikiIngest."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": (
                    "Filename for the raw document, "
                    "e.g. 'meeting-notes-2026-07.md'."
                ),
            },
            "content": {
                "type": "string",
                "description": "The document content (markdown or text).",
            },
        },
        "required": ["filename", "content"],
    }
    is_read_only: bool = False
    is_concurrency_safe: bool = False

    def __init__(self, wiki_dir: str) -> None:
        self._svc = WikiService(wiki_dir)

    async def __call__(
        self,
        filename: str,
        content: str,
    ) -> ToolChunk:
        self._svc.save_raw(filename, content)
        return ToolChunk(
            content=[TextBlock(
                text=f"Saved raw document '{filename}'. "
                f"Use WikiIngest to process it into wiki pages.",
            )],
            state=ToolResultState.SUCCESS,
        )


class WikiIngest(_WikiToolBase):
    """Ingest a raw document into wiki pages via LLM."""

    name: str = "WikiIngest"
    description: str = (
        "Ingest a raw source document into wiki pages. "
        "The LLM reads the document, extracts key concepts, "
        "entities, and topics, then creates/updates wiki pages "
        "with cross-references. Also updates index.md and log.md. "
        "Requires a model to be configured in wiki settings."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "filename": {
                "type": "string",
                "description": (
                    "The raw document filename to ingest, "
                    "e.g. 'report.md'. Must exist in raw/."
                ),
            },
        },
        "required": ["filename"],
    }
    is_read_only: bool = False
    is_concurrency_safe: bool = False

    def __init__(
        self,
        wiki_dir: str,
        storage: Any,
        user_id: str,
    ) -> None:
        self._svc = WikiService(wiki_dir)
        self._storage = storage
        self._user_id = user_id

    async def __call__(self, filename: str) -> ToolChunk:
        from .._service._model import get_model

        wiki_config = await self._storage.get_wiki_config(self._user_id)
        if wiki_config.chat_model_config is None:
            return ToolChunk(
                content=[TextBlock(
                    text="No ingest model configured. Set a model "
                    "in Wiki Settings first.",
                )],
                state=ToolResultState.ERROR,
            )

        self._svc.start_ingest(filename)
        try:
            model = await get_model(
                self._user_id,
                wiki_config.chat_model_config,
                self._storage,
            )
            result = await self._svc.ingest(filename, model)
        except FileNotFoundError:
            return ToolChunk(
                content=[TextBlock(
                    text=f"Raw document '{filename}' not found.",
                )],
                state=ToolResultState.ERROR,
            )
        except Exception as e:
            return ToolChunk(
                content=[TextBlock(text=f"Ingest failed: {e}")],
                state=ToolResultState.ERROR,
            )
        finally:
            self._svc.finish_ingest(filename)

        lines = [f"Ingested '{filename}' — {result.summary}\n"]
        lines.append(f"Created {len(result.pages)} page(s):")
        for p in result.pages:
            lines.append(
                f"- **{p.title}** ({p.category}/{p.title}.md)"
            )
        return ToolChunk(
            content=[TextBlock(text="\n".join(lines))],
            state=ToolResultState.SUCCESS,
        )


class WikiLint(_WikiToolBase):
    """Check wiki health."""

    name: str = "WikiLint"
    description: str = (
        "Run a health check on the wiki. Reports orphan pages "
        "(no inbound links), broken wikilinks, pages missing "
        "from index.md, and empty directories."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {},
    }
    is_read_only: bool = True
    is_concurrency_safe: bool = True

    def __init__(self, wiki_dir: str) -> None:
        self._svc = WikiService(wiki_dir)

    async def __call__(self) -> ToolChunk:
        result = self._svc.lint()
        lines = ["## Wiki Health Report\n"]

        total = (
            len(result.orphans)
            + len(result.broken_links)
            + len(result.missing_from_index)
            + len(result.empty_dirs)
        )

        if total == 0:
            lines.append("All clear — no issues found.")
            return ToolChunk(
                content=[TextBlock(text="\n".join(lines))],
                state=ToolResultState.SUCCESS,
            )

        if result.orphans:
            lines.append(
                f"### Orphan pages ({len(result.orphans)})"
            )
            for p in result.orphans:
                lines.append(f"- {p}")

        if result.broken_links:
            lines.append(
                f"\n### Broken links ({len(result.broken_links)})"
            )
            for bl in result.broken_links:
                lines.append(f"- {bl.page}: [[{bl.link}]]")

        if result.missing_from_index:
            lines.append(
                f"\n### Missing from index "
                f"({len(result.missing_from_index)})"
            )
            for p in result.missing_from_index:
                lines.append(f"- {p}")

        if result.empty_dirs:
            lines.append(
                f"\n### Empty directories ({len(result.empty_dirs)})"
            )
            for d in result.empty_dirs:
                lines.append(f"- {d}/")

        lines.append(f"\n**Total issues: {total}**")
        return ToolChunk(
            content=[TextBlock(text="\n".join(lines))],
            state=ToolResultState.SUCCESS,
        )
