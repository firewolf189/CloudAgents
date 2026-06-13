# -*- coding: utf-8 -*-
"""SQLite database for admin portal."""
import os
import uuid
from datetime import datetime

import aiosqlite

DB_PATH = os.path.join(os.path.dirname(__file__), "admin_portal.db")

CREATE_TABLES = """
CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    backend_url TEXT NOT NULL,
    admin_username TEXT NOT NULL DEFAULT 'admin',
    admin_password TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestrate_logs (
    id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL DEFAULT 'custom',
    task_prompt TEXT NOT NULL,
    department_ids TEXT NOT NULL,
    results TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    finished_at TEXT
);
"""


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    db = await get_db()
    try:
        await db.executescript(CREATE_TABLES)
        await db.commit()
    finally:
        await db.close()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now_iso() -> str:
    return datetime.now().isoformat()
