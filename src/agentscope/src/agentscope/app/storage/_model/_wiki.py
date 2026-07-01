# -*- coding: utf-8 -*-
"""Wiki config storage model.

Wiki content (pages, raw docs, log) is stored on the file system
under each agent's workspace directory. Only the access configuration
(model selection, authorized agents) is persisted in Redis.
"""
from pydantic import BaseModel, Field

from ._session import ChatModelConfig


class WikiConfig(BaseModel):
    """Global wiki access configuration."""

    authorized_agents: list[str] = Field(
        default_factory=list,
        description="Agent IDs allowed to access the wiki. "
        "Empty list means all agents have access.",
    )

    chat_model_config: ChatModelConfig | None = Field(
        default=None,
        description="Model configuration used for wiki ingest operations.",
    )
