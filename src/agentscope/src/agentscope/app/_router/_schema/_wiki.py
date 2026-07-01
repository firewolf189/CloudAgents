# -*- coding: utf-8 -*-
"""Request/response schemas for the wiki router."""
from pydantic import BaseModel, Field

from ...storage._model._session import ChatModelConfig


class CreateWikiPageRequest(BaseModel):
    """Request body for creating a wiki page."""

    title: str = Field(description="Display title of the page.")
    content: str = Field(
        default="",
        description="Markdown body of the page.",
    )
    category: str = Field(
        default="concept",
        description="Page category: concept, entity, topic, analysis, "
        "journal.",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Tags for categorization.",
    )
    sources: list[str] = Field(
        default_factory=list,
        description="Raw doc IDs that informed this page.",
    )


class UpdateWikiPageRequest(BaseModel):
    """Request body for updating a wiki page."""

    title: str | None = Field(default=None)
    content: str | None = Field(default=None)
    category: str | None = Field(default=None)
    tags: list[str] | None = Field(default=None)
    sources: list[str] | None = Field(default=None)


class UpdateWikiConfigRequest(BaseModel):
    """Request body for updating wiki access configuration."""

    authorized_agents: list[str] = Field(
        default_factory=list,
        description="Agent IDs allowed to access the wiki. "
        "Empty list means all agents have access.",
    )

    chat_model_config: ChatModelConfig | None = Field(
        default=None,
        description="Model configuration used for wiki ingest operations.",
    )


class UploadWikiRawRequest(BaseModel):
    """Request body for uploading a raw document."""

    filename: str = Field(description="Original filename.")
    content: str = Field(description="Full markdown content.")


class UpdateWikiRawRequest(BaseModel):
    """Request body for updating a raw document."""

    content: str = Field(description="Updated markdown content.")


class IngestPageOutput(BaseModel):
    """A single wiki page produced by the LLM during ingest."""

    title: str = Field(description="Display title of the page.")
    content: str = Field(
        description="Markdown body with [[wikilinks]] for "
        "cross-references.",
    )
    category: str = Field(
        default="concept",
        description="Page category: concept, entity, topic, analysis, "
        "journal.",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Tags for categorization.",
    )


class IngestResult(BaseModel):
    """Result of an ingest operation."""

    pages: list[IngestPageOutput] = Field(
        description="Wiki pages created or updated.",
    )
    summary: str = Field(
        description="Brief summary of what the ingest produced.",
    )
