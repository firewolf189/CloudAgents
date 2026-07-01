# -*- coding: utf-8 -*-
"""Wiki service — file-system-based knowledge base per agent.

Directory layout mirrors the llm-wiki / niannian-insurance-wiki skill:

.. code-block:: text

    wiki_dir/
    ├── index.md
    ├── log.md
    ├── raw/          # immutable source documents
    └── wiki/         # LLM-generated pages
        ├── overview.md
        ├── concepts/
        ├── entities/
        ├── topics/
        ├── analysis/
        └── journal/
"""
import json
import os
import re
from datetime import date, datetime, timedelta
from typing import Any

from pydantic import BaseModel, Field

from ...message import SystemMsg, UserMsg
from ...model import ChatModelBase


# ------------------------------------------------------------------
# Data models (returned by service, serialised to JSON by router)
# ------------------------------------------------------------------

class RawDocInfo(BaseModel):
    """Metadata for a raw source document."""
    filename: str
    status: str = "pending"  # pending | ingested | modified
    created_at: str = ""
    modified_at: str = ""


class WikiPageInfo(BaseModel):
    """Metadata for a wiki page parsed from frontmatter."""
    title: str = ""
    path: str = ""
    category: str = ""
    tags: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    created: str = ""
    updated: str = ""


class IngestPageOutput(BaseModel):
    """A single wiki page produced by the LLM during ingest."""
    title: str = Field(description="Page title.")
    description: str = Field(
        default="",
        description="One-line summary of the page (under 60 chars). "
        "Used in index.md.",
    )
    content: str = Field(
        description="Markdown body with [[wikilinks]]. "
        "Do NOT include YAML frontmatter or the # title heading.",
    )
    category: str = Field(
        description="MUST be one of: entities, topics, concepts, "
        "analysis, journal. Pick the most specific fit — companies/"
        "people/products → entities, domain clusters → topics, "
        "abstract ideas/terms → concepts.",
    )
    tags: list[str] = Field(default_factory=list)


class IngestResult(BaseModel):
    """Result of an ingest operation."""
    pages: list[IngestPageOutput] = Field(default_factory=list)
    summary: str = ""


class QueryResult(BaseModel):
    """Result of a wiki query."""
    answer: str = Field(description="Markdown answer with [[wikilinks]].")
    sources: list[str] = Field(
        default_factory=list,
        description="Wiki page paths that were used to answer.",
    )
    save_as_analysis: bool = Field(
        default=False,
        description="Whether this answer is substantial enough to "
        "save as an analysis page.",
    )
    analysis_title: str = Field(
        default="",
        description="Title for the analysis page if save_as_analysis "
        "is true.",
    )
    analysis_path: str = Field(
        default="",
        description="Path where the analysis was saved (set by server).",
    )


class BrokenLink(BaseModel):
    """A broken wikilink found during lint."""
    page: str
    link: str


class LintResult(BaseModel):
    """Result of a wiki health check."""
    orphans: list[str] = Field(default_factory=list)
    broken_links: list[BrokenLink] = Field(default_factory=list)
    missing_from_index: list[str] = Field(default_factory=list)
    empty_dirs: list[str] = Field(default_factory=list)
    no_sources: list[str] = Field(default_factory=list)
    total_pages: int = 0
    total_issues: int = 0
    score: int = 100


class GraphNode(BaseModel):
    """A node in the wiki knowledge graph."""
    id: str
    title: str
    category: str = ""
    links: int = 0


class GraphEdge(BaseModel):
    """An edge (wikilink) in the wiki knowledge graph."""
    source: str
    target: str


class GraphData(BaseModel):
    """Full graph of wiki pages and their wikilink connections."""
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


class FixLinksResult(BaseModel):
    """Result of auto-fixing lint issues."""
    pages_created: list[str] = Field(default_factory=list)
    pages_updated: list[str] = Field(default_factory=list)
    links_fixed: int = 0
    links_total: int = 0
    orphans_fixed: int = 0
    sources_fixed: int = 0
    summary: str = ""


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(
    r"^---\s*\n(.*?)\n---\s*\n",
    re.DOTALL,
)


def _parse_frontmatter(content: str) -> dict[str, Any]:
    """Parse YAML-ish frontmatter into a dict (simple key: value)."""
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return {}
    result: dict[str, Any] = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if val.startswith("[") and val.endswith("]"):
            items = [
                s.strip().strip("'\"")
                for s in val[1:-1].split(",")
                if s.strip()
            ]
            result[key] = items
        else:
            result[key] = val
    return result


def _slugify(text: str) -> str:
    """Convert text to a filename-safe slug."""
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[-\s]+", "-", text).strip("-") or "untitled"


def _build_frontmatter(
    title: str,
    tags: list[str],
    sources: list[str],
    created: str | None = None,
    updated: str | None = None,
) -> str:
    today = date.today().isoformat()
    tags_str = "[" + ", ".join(tags) + "]"
    sources_str = "[" + ", ".join(sources) + "]"
    return (
        f"---\n"
        f"title: {title}\n"
        f"tags: {tags_str}\n"
        f"sources: {sources_str}\n"
        f"created: {created or today}\n"
        f"updated: {updated or today}\n"
        f"---\n\n"
    )


# ------------------------------------------------------------------
# Service
# ------------------------------------------------------------------

_CATEGORY_DIRS = ["concepts", "entities", "topics", "analysis", "journal"]

_CATEGORY_MAP = {
    "concept": "concepts",
    "concepts": "concepts",
    "entity": "entities",
    "entities": "entities",
    "topic": "topics",
    "topics": "topics",
    "analysis": "analysis",
    "journal": "journal",
}

_INGEST_SYSTEM_PROMPT = """\
You are a wiki knowledge-base curator. Your job is to analyze a raw \
source document and produce structured wiki pages across ALL \
relevant categories.

## Categories (you MUST use the right one for each page)

- **entities**: concrete named things — companies, people, products, \
tools, organizations, brands, specific insurance plans. \
Example: "中国平安", "OpenAI", "平安淘天境外旅意(互联网版)".
- **topics**: domain clusters that group related content — a product \
line, an industry vertical, a field of study. \
Example: "宠物险专题", "Quantitative Trading", "旅行意外险".
- **concepts**: abstract ideas, terminology, frameworks, techniques, \
methods, regulatory requirements. \
Example: "趸缴", "Momentum", "RAG vs Fine-tuning".
- **analysis**: comparisons, evaluations, deep dives across multiple \
entities or concepts. Example: "Product A vs Product B".
- **journal**: time-bound observations, meeting notes, event summaries.

## Rules

### Page creation
- Create a page for EVERY distinct entity (company, product, person, \
organization), topic, and concept mentioned in the source. \
Prefer creating more focused pages over fewer summary pages — \
each product, each person, each concept deserves its own page.
- There is NO page limit. Create as many pages as the source \
material warrants. A rich source document can produce 10-30+ pages.
- Use ALL categories, not just one — a typical source mentions \
companies/products (→ entities), belongs to a domain (→ topics), \
and introduces terminology (→ concepts).

### Wikilinks — CRITICAL
- ONLY use [[double-bracket wikilinks]] for:
  1. Pages you ARE CREATING in this response.
  2. Pages that ALREADY EXIST in the Wiki Index below.
- NEVER create a [[wikilink]] to a page that does not exist and \
that you are not creating. This is the single most important rule.
- If you mention something by name but are NOT creating a page for \
it and it is NOT in the index, use **bold text** instead of \
[[wikilinks]]. Example: use **责任保险** not [[责任保险]].
- Before outputting, mentally verify EVERY [[wikilink]] — if the \
target is not in your output pages list and not in the index, \
change it to bold text.
- Actively add [[wikilinks]] to relevant existing pages from the \
Wiki Index to connect your new pages to the existing knowledge \
graph. This prevents orphan pages.

### Content
- Keep pages focused — one item per page.
- Write a one-line description (under 60 chars) for each page. \
This appears in the index. Example: "以大盘状态决定仓位的风控方法".
- Write content in the same language as the source document.
- Each page's content should be substantial markdown with sections, \
bullet points, and [[wikilinks]]. Do NOT include YAML frontmatter \
or the # title heading — they are added automatically.\
"""


def _resolve_category(cat: str) -> str:
    """Map singular or plural category name to directory name."""
    return _CATEGORY_MAP.get(cat.lower().strip(), "concepts")


class WikiService:
    """File-system wiki for a single agent."""

    def __init__(self, wiki_dir: str) -> None:
        self._dir = wiki_dir
        self._raw_dir = os.path.join(wiki_dir, "raw")
        self._wiki_dir = os.path.join(wiki_dir, "wiki")

    # -- init -------------------------------------------------------

    def init(self) -> None:
        """Create the wiki directory structure if it doesn't exist."""
        os.makedirs(self._raw_dir, exist_ok=True)
        for cat in _CATEGORY_DIRS:
            os.makedirs(
                os.path.join(self._wiki_dir, cat),
                exist_ok=True,
            )
        index_path = os.path.join(self._dir, "index.md")
        if not os.path.exists(index_path):
            with open(index_path, "w", encoding="utf-8") as f:
                f.write(
                    "# Wiki Index\n\n"
                    "> This index is maintained automatically. "
                    "It catalogs every page in the wiki with a "
                    "one-line summary. Read this first when "
                    "answering queries.\n\n"
                    "## Concepts\n\n"
                    "## Entities\n\n"
                    "## Topics\n\n"
                    "## Analysis\n\n"
                    "## Journal\n\n"
                    "## Sources (chronological)\n"
                )
        log_path = os.path.join(self._dir, "log.md")
        if not os.path.exists(log_path):
            with open(log_path, "w", encoding="utf-8") as f:
                f.write("# Wiki Log\n")

    # -- raw documents ----------------------------------------------

    def list_raws(self) -> list[RawDocInfo]:
        """List raw documents with status: pending/ingested/modified."""
        if not os.path.isdir(self._raw_dir):
            return []
        log_content = self.read_log()
        ingest_times = self._parse_ingest_times(log_content)
        _FMT = "%Y-%m-%d %H:%M:%S"
        result = []
        for fn in sorted(os.listdir(self._raw_dir)):
            if not fn.endswith(".md"):
                continue
            fpath = os.path.join(self._raw_dir, fn)
            st = os.stat(fpath)
            btime = getattr(st, "st_birthtime", st.st_ctime)
            ctime = datetime.fromtimestamp(btime)
            mtime = datetime.fromtimestamp(st.st_mtime)
            last_ingest = ingest_times.get(fn)
            if last_ingest is None:
                status = "pending"
            else:
                status = "modified" if mtime > last_ingest + \
                    timedelta(seconds=60) else "ingested"
            result.append(RawDocInfo(
                filename=fn,
                status=status,
                created_at=ctime.strftime(_FMT),
                modified_at=mtime.strftime(_FMT),
            ))
        return result

    # -- ingest status tracking ----------------------------------------

    @property
    def _ingest_status_path(self) -> str:
        return os.path.join(self._dir, ".ingest_status.json")

    def start_ingest(self, filename: str) -> None:
        """Mark a file as currently being ingested."""
        active = self.get_ingest_status()
        if filename not in active:
            active.append(filename)
        with open(self._ingest_status_path, "w") as f:
            json.dump(active, f)

    def finish_ingest(self, filename: str) -> None:
        """Remove a file from the currently-ingesting set."""
        active = self.get_ingest_status()
        active = [fn for fn in active if fn != filename]
        if active:
            with open(self._ingest_status_path, "w") as f:
                json.dump(active, f)
        elif os.path.exists(self._ingest_status_path):
            os.remove(self._ingest_status_path)

    def get_ingest_status(self) -> list[str]:
        """Return list of filenames currently being ingested."""
        if not os.path.exists(self._ingest_status_path):
            return []
        try:
            with open(self._ingest_status_path) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []

    @staticmethod
    def _parse_ingest_times(log_content: str) -> dict[str, datetime]:
        """Extract the most recent ingest timestamp per filename."""
        _TS_FMTS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d")
        times: dict[str, datetime] = {}
        for m in re.finditer(
            r"## \[([^\]]+)\] ingest \| (.+)",
            log_content,
        ):
            ts_str, fn = m.group(1).strip(), m.group(2).strip()
            ts: datetime | None = None
            for fmt in _TS_FMTS:
                try:
                    ts = datetime.strptime(ts_str, fmt)
                    break
                except ValueError:
                    continue
            if ts is None:
                continue
            if fn not in times or ts > times[fn]:
                times[fn] = ts
        return times

    def read_raw(self, filename: str) -> str:
        path = os.path.join(self._raw_dir, filename)
        if not os.path.isfile(path):
            raise FileNotFoundError(f"Raw document '{filename}' not found.")
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def save_raw(self, filename: str, content: str) -> None:
        os.makedirs(self._raw_dir, exist_ok=True)
        path = os.path.join(self._raw_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    def delete_raw(self, filename: str) -> None:
        path = os.path.join(self._raw_dir, filename)
        if os.path.isfile(path):
            os.remove(path)

    # -- wiki pages -------------------------------------------------

    def list_pages(self) -> list[WikiPageInfo]:
        """Walk wiki/ and parse frontmatter from each .md file."""
        pages = []
        if not os.path.isdir(self._wiki_dir):
            return pages
        for root, _dirs, files in os.walk(self._wiki_dir):
            for fn in sorted(files):
                if not fn.endswith(".md"):
                    continue
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, self._wiki_dir)
                with open(full, "r", encoding="utf-8") as f:
                    content = f.read()
                fm = _parse_frontmatter(content)
                cat = os.path.dirname(rel) if "/" in rel else ""
                pages.append(WikiPageInfo(
                    title=fm.get("title", fn.replace(".md", "")),
                    path=rel,
                    category=cat or fm.get("category", ""),
                    tags=fm.get("tags", []),
                    sources=fm.get("sources", []),
                    created=fm.get("created", ""),
                    updated=fm.get("updated", ""),
                ))
        return pages

    def read_page(self, path: str) -> str:
        full = os.path.join(self._wiki_dir, path)
        if not os.path.isfile(full):
            raise FileNotFoundError(f"Wiki page '{path}' not found.")
        with open(full, "r", encoding="utf-8") as f:
            return f.read()

    def save_page(self, path: str, content: str) -> None:
        dirname = os.path.dirname(path)
        basename = os.path.basename(path)
        name, ext = os.path.splitext(basename)
        slug = _slugify(name) + (ext or ".md")
        normalized = os.path.join(dirname, slug) if dirname else slug
        full = os.path.join(self._wiki_dir, normalized)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)

    def delete_page(self, path: str) -> None:
        full = os.path.join(self._wiki_dir, path)
        if os.path.isfile(full):
            os.remove(full)

    # -- directory operations ------------------------------------------

    def create_dir(self, path: str) -> None:
        """Create a subdirectory under wiki/."""
        full = os.path.join(self._wiki_dir, path)
        os.makedirs(full, exist_ok=True)

    def delete_dir(self, path: str) -> None:
        """Delete a subdirectory under wiki/ and all its contents."""
        import shutil
        full = os.path.join(self._wiki_dir, path)
        if os.path.isdir(full):
            shutil.rmtree(full)

    # -- index & log ------------------------------------------------

    def read_index(self) -> str:
        path = os.path.join(self._dir, "index.md")
        if not os.path.isfile(path):
            return ""
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def write_index(self, content: str) -> None:
        path = os.path.join(self._dir, "index.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    def read_log(self) -> str:
        path = os.path.join(self._dir, "log.md")
        if not os.path.isfile(path):
            return ""
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def rebuild_index(self) -> str:
        """Rebuild index.md from all existing wiki pages.

        Extracts a one-line description from each page's first
        paragraph and counts sources. Returns the new index content.
        """
        self.init()
        pages = self.list_pages()

        cats: dict[str, list[str]] = {
            c: [] for c in _CATEGORY_DIRS
        }
        for p in pages:
            cat = p.category if p.category in cats else "concepts"
            desc = self._extract_description(p.path)
            src_count = len(p.sources)
            src_text = (
                f" ({src_count} source{'s' if src_count != 1 else ''})"
                if src_count else ""
            )
            desc_text = f" — {desc}" if desc else ""
            slug = os.path.splitext(p.path)[0]
            entry = (
                f"- [[wiki/{slug}|{p.title}]]"
                f"{desc_text}{src_text}"
            )
            cats[cat].append(entry)

        # Build sources section from log
        log_content = self.read_log()
        source_entries = []
        for m in re.finditer(
            r"## \[([^\]]+)\] ingest \| (.+)",
            log_content,
        ):
            ts_str, fn = m.group(1).strip(), m.group(2).strip()
            ts_date = ts_str.split(" ")[0]
            entry = f"- [{ts_date}] [[raw/{fn}|{fn}]]"
            if entry not in source_entries:
                source_entries.append(entry)

        lines = [
            "# Wiki Index\n",
            "> This index is maintained automatically. "
            "It catalogs every page in the wiki with a one-line "
            "summary. Read this first when answering queries.\n",
        ]
        section_labels = {
            "concepts": "Concepts",
            "entities": "Entities",
            "topics": "Topics",
            "analysis": "Analysis",
            "journal": "Journal",
        }
        for cat_key in _CATEGORY_DIRS:
            label = section_labels.get(cat_key, cat_key.title())
            lines.append(f"## {label}")
            if cats[cat_key]:
                lines.extend(cats[cat_key])
            lines.append("")

        lines.append("## Sources (chronological)")
        if source_entries:
            lines.extend(source_entries)
        lines.append("")

        new_index = "\n".join(lines)
        self.write_index(new_index)
        return new_index

    def _extract_description(self, page_path: str) -> str:
        """Extract a one-line description from a wiki page."""
        try:
            content = self.read_page(page_path)
        except FileNotFoundError:
            return ""
        fm_match = _FRONTMATTER_RE.match(content)
        body = content[fm_match.end():] if fm_match else content
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            line = re.sub(r"\[\[([^\]|]*\|)?([^\]]+)\]\]", r"\2", line)
            line = re.sub(r"\*\*([^*]+)\*\*", r"\1", line)
            line = line.lstrip("- •·")
            line = line.strip()
            if len(line) > 10:
                if len(line) > 80:
                    line = line[:77] + "..."
                return line
        return ""

    def append_log(self, entry: str) -> None:
        """Prepend a log entry (newest first, after the header line)."""
        path = os.path.join(self._dir, "log.md")
        if not os.path.isfile(path):
            with open(path, "w", encoding="utf-8") as f:
                f.write("# Wiki Log\n\n" + entry + "\n")
            return
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        header = "# Wiki Log\n"
        if content.startswith(header):
            content = header + "\n" + entry + "\n" + content[len(header):]
        else:
            content = header + "\n" + entry + "\n" + content
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    # -- ingest -----------------------------------------------------

    async def ingest(
        self,
        filename: str,
        model: ChatModelBase,
    ) -> IngestResult:
        """Read a raw document, call LLM, write wiki pages, update
        index and log."""
        self.init()
        raw_content = self.read_raw(filename)
        existing_index = self.read_index()

        user_content = (
            f"## Source Document: {filename}\n\n"
            f"{raw_content}\n\n"
            f"---\n\n"
            f"## Existing Wiki Index (use [[title]] to link)\n\n"
            f"{existing_index}\n\n"
            f"---\n\n"
            f"REMINDER: Only use [[wikilinks]] for pages in YOUR "
            f"output or in the index above. Everything else must "
            f"use **bold text**."
        )

        messages = [
            SystemMsg(name="wiki-curator", content=_INGEST_SYSTEM_PROMPT),
            UserMsg(name="user", content=user_content),
        ]

        response = await model.generate_structured_output(
            messages,
            structured_model=IngestResult,
        )
        content = response.content
        if isinstance(content, str):
            content = json.loads(content)
        result = IngestResult.model_validate(content)

        today = date.today().isoformat()
        pages_created: list[str] = []
        index_additions: list[str] = []

        for page in result.pages:
            slug = _slugify(page.title)
            cat = _resolve_category(page.category)
            rel_path = f"{cat}/{slug}.md"

            # Check if page already exists — merge instead of overwrite
            try:
                existing = self.read_page(rel_path)
                existing_fm = _parse_frontmatter(existing)
                # Merge sources
                old_sources = existing_fm.get("sources", [])
                if isinstance(old_sources, str):
                    old_sources = [old_sources]
                new_source = f"raw/{filename}"
                merged_sources = list(
                    dict.fromkeys(old_sources + [new_source]),
                )
                # Merge tags
                old_tags = existing_fm.get("tags", [])
                if isinstance(old_tags, str):
                    old_tags = [old_tags]
                merged_tags = list(
                    dict.fromkeys(old_tags + page.tags),
                )
                # Strip old frontmatter + heading, keep body
                body_match = _FRONTMATTER_RE.match(existing)
                old_body = existing[body_match.end():] \
                    if body_match else existing
                # Remove leading "# Title\n\n" if present
                heading = f"# {page.title}\n"
                if old_body.lstrip().startswith(heading):
                    old_body = old_body.lstrip()[len(heading):]
                    old_body = old_body.lstrip("\n")

                full_content = _build_frontmatter(
                    title=page.title,
                    tags=merged_tags,
                    sources=merged_sources,
                    created=existing_fm.get("created"),
                ) + f"# {page.title}\n\n" \
                    + old_body.rstrip() \
                    + f"\n\n---\n*（补充来源：raw/{filename}）*\n\n" \
                    + page.content
            except FileNotFoundError:
                full_content = _build_frontmatter(
                    title=page.title,
                    tags=page.tags,
                    sources=[f"raw/{filename}"],
                ) + f"# {page.title}\n\n" + page.content

            self.save_page(rel_path, full_content)
            pages_created.append(rel_path)
            index_additions.append(
                f"- [[wiki/{rel_path}|{page.title}]]"
            )

        # Update index.md — append to matching category section
        index = self.read_index()
        for page in result.pages:
            slug = _slugify(page.title)
            cat = _resolve_category(page.category)
            section = cat.title()
            desc = f" — {page.description}" if page.description else ""
            entry = (
                f"- [[wiki/{cat}/{slug}|{page.title}]]{desc}"
            )
            if f"[[wiki/{cat}/{slug}|" not in index:
                marker = f"## {section}"
                if marker in index:
                    index = index.replace(
                        marker,
                        f"{marker}\n{entry}",
                    )

        source_entry = (
            f"- [{today}] [[raw/{filename}|{filename}]]"
        )
        if source_entry not in index:
            if "## Sources" in index:
                index = index.replace(
                    "## Sources (chronological)",
                    f"## Sources (chronological)\n{source_entry}",
                )
            else:
                index += f"\n## Sources (chronological)\n{source_entry}\n"
        self.write_index(index)

        # Prepend log (newest first)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = (
            f"## [{now}] ingest | {filename}\n"
            f"- Created: {', '.join(pages_created)}\n"
            f"- Tags: {', '.join(set(t for p in result.pages for t in p.tags))}\n"
            f"- Key insight: {result.summary}"
        )
        self.append_log(log_entry)

        # Post-process: replace broken [[wikilinks]] with **bold**
        self._sanitize_links(pages_created)

        # Auto re-link: scan existing pages and add back-links to
        # newly created pages to prevent orphans.
        self._relink(pages_created)

        return result

    # -- query ----------------------------------------------------------

    _QUERY_SYSTEM_PROMPT = """\
You are a knowledge-base assistant. Answer the user's question by \
synthesizing information from the wiki pages provided below.

Rules:
- Use [[wikilinks]] when referencing wiki pages.
- If information is missing from the wiki, say so — do not hallucinate.
- Ground answers in the wiki's sources; cite page titles.
- Answer in the same language as the question.
- Set save_as_analysis=true ONLY when your answer is a substantial \
comparison, evaluation, or deep dive that would be worth saving for \
future reference. Simple factual lookups should NOT be saved.\
"""

    async def query(
        self,
        question: str,
        model: ChatModelBase,
    ) -> QueryResult:
        """Query the wiki with a question, LLM synthesizes an answer."""
        self.init()

        pages = self.list_pages()
        q = question.lower()
        relevant = []
        for p in pages:
            if (
                q in p.title.lower()
                or any(q in t.lower() for t in p.tags)
            ):
                relevant.append(p)
                continue
            try:
                content = self.read_page(p.path)
                if q in content.lower():
                    relevant.append(p)
            except FileNotFoundError:
                continue

        if not relevant:
            relevant = pages[:10]

        context_parts = []
        for p in relevant[:15]:
            try:
                content = self.read_page(p.path)
                context_parts.append(
                    f"### {p.title} ({p.path})\n\n{content}"
                )
            except FileNotFoundError:
                continue

        wiki_context = "\n\n---\n\n".join(context_parts)
        user_content = (
            f"## Question\n\n{question}\n\n"
            f"## Wiki Pages\n\n{wiki_context}"
        )

        messages = [
            SystemMsg(
                name="wiki-assistant",
                content=self._QUERY_SYSTEM_PROMPT,
            ),
            UserMsg(name="user", content=user_content),
        ]

        response = await model.generate_structured_output(
            messages,
            structured_model=QueryResult,
        )
        qcontent = response.content
        if isinstance(qcontent, str):
            qcontent = json.loads(qcontent)
        result = QueryResult.model_validate(qcontent)
        result.sources = [p.path for p in relevant[:15]]

        if result.save_as_analysis and result.analysis_title:
            slug = _slugify(result.analysis_title)
            rel_path = f"analysis/{slug}.md"
            full_content = _build_frontmatter(
                title=result.analysis_title,
                tags=["analysis"],
                sources=[p.path for p in relevant[:5]],
            ) + f"# {result.analysis_title}\n\n{result.answer}"
            self.save_page(rel_path, full_content)
            result.analysis_path = rel_path

            index = self.read_index()
            entry = f"- [[wiki/{rel_path}|{result.analysis_title}]]"
            if entry not in index and "## Analysis" in index:
                index = index.replace(
                    "## Analysis",
                    f"## Analysis\n{entry}",
                )
                self.write_index(index)

            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            self.append_log(
                f"## [{now}] query | {question[:60]}\n"
                f"- Read: {', '.join(p.path for p in relevant[:5])}\n"
                f"- Created: {rel_path}"
            )

        return result

    # -- lint -----------------------------------------------------------

    def lint(self) -> LintResult:
        """Check wiki health — pure file-system scan, no LLM."""
        self.init()
        pages = self.list_pages()
        index_content = self.read_index()

        all_titles = {p.title.lower() for p in pages}
        all_slugs = set()
        for p in pages:
            name = os.path.splitext(os.path.basename(p.path))[0]
            all_slugs.add(name.lower())
            all_slugs.add(p.title.lower())

        page_contents: dict[str, str] = {}
        outgoing_links: dict[str, list[str]] = {}
        incoming: dict[str, int] = {p.path: 0 for p in pages}

        for p in pages:
            try:
                content = self.read_page(p.path)
            except FileNotFoundError:
                continue
            page_contents[p.path] = content
            links = re.findall(r"\[\[([^\]|]+)", content)
            outgoing_links[p.path] = links

        broken_links: list[BrokenLink] = []
        for page_path, links in outgoing_links.items():
            for link in links:
                link_lower = link.lower().strip()
                target = self._resolve_link(
                    link_lower, pages, all_titles, all_slugs,
                )
                if target:
                    incoming[target.path] = (
                        incoming.get(target.path, 0) + 1
                    )
                else:
                    broken_links.append(
                        BrokenLink(page=page_path, link=link)
                    )

        orphans = [
            p.path for p in pages if incoming.get(p.path, 0) == 0
        ]

        missing_from_index = [
            p.path for p in pages
            if p.title not in index_content
            and p.path not in index_content
        ]

        empty_dirs = []
        if os.path.isdir(self._wiki_dir):
            for d in os.listdir(self._wiki_dir):
                full = os.path.join(self._wiki_dir, d)
                if os.path.isdir(full) and not os.listdir(full):
                    empty_dirs.append(d)

        no_sources = [
            p.path for p in pages if not p.sources
        ]

        total_issues = (
            len(orphans) + len(broken_links)
            + len(missing_from_index) + len(no_sources)
        )
        total_pages = len(pages)
        score = max(
            0,
            100 - (total_issues * 100 // max(total_pages * 3, 1)),
        ) if total_pages > 0 else 100

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.append_log(
            f"## [{now}] lint | Wiki health check\n"
            f"- Score: {score}/100\n"
            f"- Orphans: {len(orphans)}\n"
            f"- Broken links: {len(broken_links)}\n"
            f"- Missing from index: {len(missing_from_index)}\n"
            f"- No sources: {len(no_sources)}"
        )

        return LintResult(
            orphans=orphans,
            broken_links=broken_links,
            missing_from_index=missing_from_index,
            empty_dirs=empty_dirs,
            no_sources=no_sources,
            total_pages=total_pages,
            total_issues=total_issues,
            score=score,
        )

    # -- graph --------------------------------------------------------------

    def graph(self) -> GraphData:
        """Build a knowledge graph from wikilinks — no LLM."""
        self.init()
        pages = self.list_pages()
        if not pages:
            return GraphData()

        all_titles = {p.title.lower() for p in pages}
        all_slugs: set[str] = set()
        for p in pages:
            name = os.path.splitext(os.path.basename(p.path))[0]
            all_slugs.add(name.lower())
            all_slugs.add(p.title.lower())

        incoming: dict[str, int] = {p.path: 0 for p in pages}
        edges: list[GraphEdge] = []
        seen_edges: set[tuple[str, str]] = set()

        for p in pages:
            try:
                content = self.read_page(p.path)
            except FileNotFoundError:
                continue
            links = re.findall(r"\[\[([^\]|]+)", content)
            for link in links:
                target = self._resolve_link(
                    link.lower().strip(), pages, all_titles, all_slugs,
                )
                if not target or target.path == p.path:
                    continue
                pair = (p.path, target.path)
                if pair not in seen_edges:
                    seen_edges.add(pair)
                    edges.append(GraphEdge(
                        source=p.path, target=target.path,
                    ))
                    incoming[target.path] = (
                        incoming.get(target.path, 0) + 1
                    )

        nodes = [
            GraphNode(
                id=p.path,
                title=p.title,
                category=p.category,
                links=incoming.get(p.path, 0),
            )
            for p in pages
        ]
        return GraphData(nodes=nodes, edges=edges)

    # -- fix broken links -----------------------------------------------

    _FIX_LINKS_SYSTEM_PROMPT = """\
You are a wiki knowledge-base curator. You are given a list of \
broken [[wikilinks]] — link targets that are referenced in existing \
wiki pages but have no corresponding page yet.

For each broken link, create a wiki page. Use context from the \
pages that reference the link to write meaningful content.

## Categories (pick the best fit for each page)

- **entities**: concrete named things — companies, people, products, \
tools, organizations, brands, specific insurance plans.
- **topics**: domain clusters that group related content — a product \
line, an industry vertical, a field of study.
- **concepts**: abstract ideas, terminology, frameworks, techniques, \
methods, regulatory requirements.
- **analysis**: comparisons, evaluations, deep dives.
- **journal**: time-bound observations.

## Rules

- The page title MUST exactly match the broken link text (so the \
link resolves after the page is created).
- Write content in the same language as the context.
- Use [[double-bracket wikilinks]] to cross-reference other pages \
(ONLY those that already exist in the index or that you are creating).
- Keep pages focused — one item per page.
- Each page's content should be substantial markdown with sections \
and [[wikilinks]]. Do NOT include YAML frontmatter or the # title \
heading — they are added automatically.\
"""

    async def fix(
        self,
        model: ChatModelBase,
    ) -> FixLinksResult:
        """Auto-fix all lint issues: broken links, no sources, orphans."""
        self.init()
        lint_result = self.lint()

        all_created: list[str] = []
        all_updated: list[str] = []
        links_fixed = 0
        orphans_fixed = 0
        sources_fixed = 0

        # --- 1. Fix broken links: create missing pages ----------------
        if lint_result.broken_links:
            unique_links: dict[str, list[str]] = {}
            for bl in lint_result.broken_links:
                unique_links.setdefault(bl.link, []).append(bl.page)

            context_parts = []
            for link, ref_pages in unique_links.items():
                snippets = []
                for rp in ref_pages[:3]:
                    try:
                        content = self.read_page(rp)
                        for line in content.splitlines():
                            if f"[[{link}]]" in line or \
                                    f"[[{link}|" in line:
                                snippets.append(
                                    f"  - ({rp}) {line.strip()}"
                                )
                    except FileNotFoundError:
                        continue
                refs = "\n".join(snippets) if snippets \
                    else "  - (no context)"
                context_parts.append(
                    f"### {link}\nReferenced in:\n{refs}"
                )

            existing_index = self.read_index()
            batch_size = 20
            link_names = list(unique_links.keys())

            for i in range(0, len(context_parts), batch_size):
                batch = context_parts[i:i + batch_size]

                user_content = (
                    f"## Broken Links to Fix ({len(batch)})\n\n"
                    + "\n\n".join(batch)
                    + f"\n\n---\n\n"
                    f"## Existing Wiki Index\n\n{existing_index}"
                )

                messages = [
                    SystemMsg(
                        name="wiki-curator",
                        content=self._FIX_LINKS_SYSTEM_PROMPT,
                    ),
                    UserMsg(name="user", content=user_content),
                ]

                response = await model.generate_structured_output(
                    messages,
                    structured_model=IngestResult,
                )
                fcontent = response.content
                if isinstance(fcontent, str):
                    fcontent = json.loads(fcontent)
                result = IngestResult.model_validate(fcontent)

                for page in result.pages:
                    slug = _slugify(page.title)
                    cat = _resolve_category(page.category)
                    rel_path = f"{cat}/{slug}.md"

                    # Skip if page already exists
                    try:
                        self.read_page(rel_path)
                        continue
                    except FileNotFoundError:
                        pass

                    ref_pages = unique_links.get(page.title, [])
                    page_sources = self._derive_sources(ref_pages)

                    full_content = _build_frontmatter(
                        title=page.title,
                        tags=page.tags,
                        sources=page_sources,
                    ) + f"# {page.title}\n\n" + page.content

                    self.save_page(rel_path, full_content)
                    all_created.append(rel_path)

                    index = self.read_index()
                    section = cat.title()
                    entry = (
                        f"- [[wiki/{cat}/{slug}|{page.title}]]"
                    )
                    if entry not in index:
                        marker = f"## {section}"
                        if marker in index:
                            index = index.replace(
                                marker,
                                f"{marker}\n{entry}",
                            )
                            self.write_index(index)

            links_fixed = len(link_names)

        # --- 2. Fix no-sources: derive from referencing pages ---------
        if lint_result.no_sources:
            pages = self.list_pages()
            page_map = {p.path: p for p in pages}
            page_contents: dict[str, str] = {}
            for p in pages:
                try:
                    page_contents[p.path] = self.read_page(p.path)
                except FileNotFoundError:
                    continue

            for ns_path in lint_result.no_sources:
                ns_page = page_map.get(ns_path)
                if not ns_page:
                    continue
                derived = self._derive_sources_from_refs(
                    ns_path, ns_page.title, pages, page_contents,
                )
                if not derived:
                    continue
                try:
                    content = self.read_page(ns_path)
                except FileNotFoundError:
                    continue
                updated = self._update_frontmatter_sources(
                    content, derived,
                )
                if updated != content:
                    self.save_page(ns_path, updated)
                    all_updated.append(ns_path)
                    sources_fixed += 1

        # --- 3. Fix orphans: add links from related pages -------------
        if lint_result.orphans:
            pages = self.list_pages()
            page_contents_fresh: dict[str, str] = {}
            for p in pages:
                try:
                    page_contents_fresh[p.path] = self.read_page(
                        p.path,
                    )
                except FileNotFoundError:
                    continue

            for orphan_path in lint_result.orphans:
                orphan_page = next(
                    (p for p in pages if p.path == orphan_path),
                    None,
                )
                if not orphan_page:
                    continue
                best = self._find_best_linker(
                    orphan_page, pages, page_contents_fresh,
                )
                if not best:
                    continue
                content = page_contents_fresh[best]
                link = f"[[{orphan_page.title}]]"
                if link in content:
                    continue
                section = "\n\n## 相关页面\n" \
                    if "## 相关" not in content \
                    else ""
                if section:
                    content += f"{section}- {link}\n"
                else:
                    idx = content.find("## 相关")
                    end = content.find("\n\n", idx + 1)
                    if end == -1:
                        content += f"\n- {link}\n"
                    else:
                        content = (
                            content[:end]
                            + f"\n- {link}"
                            + content[end:]
                        )
                self.save_page(best, content)
                page_contents_fresh[best] = content
                if best not in all_updated:
                    all_updated.append(best)
                orphans_fixed += 1

        # --- Log & return ---------------------------------------------
        parts = []
        if links_fixed:
            parts.append(f"broken links: {links_fixed}")
        if sources_fixed:
            parts.append(f"no-sources: {sources_fixed}")
        if orphans_fixed:
            parts.append(f"orphans: {orphans_fixed}")
        summary_detail = ", ".join(parts) if parts else "nothing"

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.append_log(
            f"## [{now}] fix | Auto-fix lint issues\n"
            f"- Fixed: {summary_detail}\n"
            f"- Created: {', '.join(all_created) or '(none)'}\n"
            f"- Updated: {', '.join(all_updated) or '(none)'}"
        )

        return FixLinksResult(
            pages_created=all_created,
            pages_updated=all_updated,
            links_fixed=links_fixed,
            links_total=links_fixed,
            orphans_fixed=orphans_fixed,
            sources_fixed=sources_fixed,
            summary=f"Fixed {summary_detail}. "
            f"Created {len(all_created)}, "
            f"updated {len(all_updated)} pages.",
        )

    # -- fix helpers ---------------------------------------------------

    def _derive_sources(self, ref_pages: list[str]) -> list[str]:
        """Derive source list from referencing pages' sources."""
        sources: set[str] = set()
        for rp in ref_pages:
            try:
                content = self.read_page(rp)
            except FileNotFoundError:
                continue
            fm = _parse_frontmatter(content)
            for s in fm.get("sources", []):
                sources.add(s)
        return sorted(sources)

    def _derive_sources_from_refs(
        self,
        target_path: str,
        target_title: str,
        all_pages: list[WikiPageInfo],
        page_contents: dict[str, str],
    ) -> list[str]:
        """Find sources from pages that reference the target."""
        sources: set[str] = set()
        target_lower = target_title.lower()
        target_slug = os.path.splitext(
            os.path.basename(target_path),
        )[0].lower()
        for p in all_pages:
            if p.path == target_path:
                continue
            content = page_contents.get(p.path, "")
            if f"[[{target_title}]]" in content or \
                    f"[[{target_title}|" in content or \
                    f"[[{target_slug}]]" in content:
                for s in p.sources:
                    sources.add(s)
        return sorted(sources)

    def _update_frontmatter_sources(
        self,
        content: str,
        sources: list[str],
    ) -> str:
        """Update the sources field in frontmatter."""
        m = _FRONTMATTER_RE.match(content)
        if not m:
            return content
        fm_text = m.group(1)
        sources_str = (
            "[" + ", ".join(sources) + "]"
        )
        new_fm = re.sub(
            r"^sources:.*$",
            f"sources: {sources_str}",
            fm_text,
            flags=re.MULTILINE,
        )
        if new_fm == fm_text:
            return content
        return content[:m.start(1)] + new_fm + content[m.end(1):]

    def _find_best_linker(
        self,
        orphan: WikiPageInfo,
        all_pages: list[WikiPageInfo],
        page_contents: dict[str, str],
    ) -> str | None:
        """Find the best existing page to add a link to the orphan."""
        orphan_tags = set(t.lower() for t in orphan.tags)
        best_path = None
        best_score = 0
        for p in all_pages:
            if p.path == orphan.path:
                continue
            content = page_contents.get(p.path, "")
            score = 0
            if orphan.title.lower() in content.lower():
                score += 3
            p_tags = set(t.lower() for t in p.tags)
            score += len(orphan_tags & p_tags)
            if orphan.category and p.category == orphan.category:
                score += 1
            if score > best_score:
                best_score = score
                best_path = p.path
        return best_path if best_score >= 1 else None

    def _sanitize_links(self, page_paths: list[str]) -> None:
        """Replace [[wikilinks]] that point to non-existent pages
        with **bold text** in the given pages. Pure code, no LLM."""
        all_pages = self.list_pages()
        all_titles = {p.title.lower() for p in all_pages}
        all_slugs = set()
        for p in all_pages:
            name = os.path.splitext(os.path.basename(p.path))[0]
            all_slugs.add(name.lower())
            all_slugs.add(p.title.lower())

        for path in page_paths:
            try:
                content = self.read_page(path)
            except FileNotFoundError:
                continue
            fm_match = _FRONTMATTER_RE.match(content)
            if fm_match:
                body_start = fm_match.end()
                frontmatter = content[:body_start]
                body = content[body_start:]
            else:
                frontmatter = ""
                body = content

            def _replace(m: re.Match) -> str:
                link = m.group(1).strip()
                target = self._resolve_link(
                    link.lower(), all_pages, all_titles, all_slugs,
                )
                if target:
                    return m.group(0)
                return f"**{link}**"

            new_body = re.sub(
                r"\[\[([^\]|]+)\]\]", _replace, body,
            )
            if new_body != body:
                self.save_page(path, frontmatter + new_body)

    @staticmethod
    def _resolve_link(
        link_lower: str,
        pages: list[WikiPageInfo],
        all_titles: set[str],
        all_slugs: set[str],
    ) -> WikiPageInfo | None:
        """Resolve a wikilink to a page, supporting exact and fuzzy
        matching (same logic as the frontend navigator)."""
        # 0. Strip wiki/ prefix from path-style links
        #    e.g. "wiki/entities/addy-osmani" → "entities/addy-osmani"
        normalized = link_lower
        if normalized.startswith("wiki/"):
            normalized = normalized[5:]
        # Strip .md extension if present
        if normalized.endswith(".md"):
            normalized = normalized[:-3]

        # 0b. Try path match (e.g. "entities/addy-osmani" → path)
        for p in pages:
            p_path = p.path.lower()
            if p_path.endswith(".md"):
                p_path = p_path[:-3]
            if normalized == p_path:
                return p

        # 1. Exact match on title or slug
        if normalized in all_titles or normalized in all_slugs:
            for p in pages:
                tname = os.path.splitext(
                    os.path.basename(p.path),
                )[0]
                if (
                    p.title.lower() == normalized
                    or tname.lower() == normalized
                ):
                    return p
        # Also try the original link text (without wiki/ strip)
        if link_lower != normalized and (
            link_lower in all_titles or link_lower in all_slugs
        ):
            for p in pages:
                tname = os.path.splitext(
                    os.path.basename(p.path),
                )[0]
                if (
                    p.title.lower() == link_lower
                    or tname.lower() == link_lower
                ):
                    return p

        # 2. Fuzzy: link text contained in title or slug
        # Use the basename from the link for fuzzy match
        link_basename = normalized.rsplit("/", 1)[-1]
        for p in pages:
            tname = os.path.splitext(
                os.path.basename(p.path),
            )[0]
            if (
                link_basename in p.title.lower()
                or link_basename in tname.lower()
                or p.title.lower() in link_basename
                or tname.lower() in link_basename
            ):
                return p
        return None

    def _relink(self, new_paths: list[str]) -> None:
        """Add back-links from existing pages to newly created pages.

        Pure code — no LLM. Scans all existing pages for title/tag
        overlap and appends wikilinks where relevant.
        """
        if not new_paths:
            return
        all_pages = self.list_pages()
        new_set = set(new_paths)
        new_pages = [p for p in all_pages if p.path in new_set]
        old_pages = [p for p in all_pages if p.path not in new_set]
        if not new_pages or not old_pages:
            return

        old_contents: dict[str, str] = {}
        for p in old_pages:
            try:
                old_contents[p.path] = self.read_page(p.path)
            except FileNotFoundError:
                continue

        for new_p in new_pages:
            link = f"[[{new_p.title}]]"
            new_tags = set(t.lower() for t in new_p.tags)
            title_lower = new_p.title.lower()

            for old_p in old_pages:
                content = old_contents.get(old_p.path, "")
                if link in content:
                    continue
                # Score relevance
                score = 0
                if title_lower in content.lower():
                    score += 3
                old_tags = set(t.lower() for t in old_p.tags)
                score += len(new_tags & old_tags)
                if score < 2:
                    continue

                if "## 相关" in content or "## Related" in content:
                    content = content.rstrip() + f"\n- {link}\n"
                else:
                    content = content.rstrip() \
                        + f"\n\n## 相关页面\n- {link}\n"
                self.save_page(old_p.path, content)
                old_contents[old_p.path] = content
