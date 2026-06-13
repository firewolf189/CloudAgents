# -*- coding: utf-8 -*-
"""Admin Portal — FastAPI entry point."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import uvicorn
from fastapi import Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from auth import decode_jwt
from auth_router import auth_router
from chat_proxy_router import chat_router
from dashboard_router import dashboard_router
from db import init_db
from department_router import dept_router
from orchestrate_router import orchestrate_router

from fastapi import FastAPI

app = FastAPI(title="CloudAgents Admin Portal")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


OPEN_PATHS = {"/auth/login", "/docs", "/openapi.json", "/redoc"}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method == "OPTIONS":
            return await call_next(request)
        path = request.url.path
        if path in OPEN_PATHS or path.startswith("/auth/"):
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return Response(
                content='{"detail":"Authorization required."}',
                status_code=401,
                media_type="application/json",
            )
        try:
            decode_jwt(auth_header[7:])
        except Exception:
            return Response(
                content='{"detail":"Invalid or expired token."}',
                status_code=401,
                media_type="application/json",
            )
        return await call_next(request)


app.add_middleware(AuthMiddleware)

app.include_router(auth_router)
app.include_router(dept_router)
app.include_router(dashboard_router)
app.include_router(orchestrate_router)
app.include_router(chat_router)


@app.on_event("startup")
async def startup():
    await init_db()


if __name__ == "__main__":
    port = int(os.getenv("PORTAL_PORT", "8080"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
