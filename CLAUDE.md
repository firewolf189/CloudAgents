# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

This is a monorepo for **AgentScope 2.0**, a multi-agent platform by Alibaba Tongyi Lab. It contains:

- `agent_service/` — FastAPI service wiring up the core library with Redis storage, message bus, and workspace management. Main development target.
- `web_ui/` — pnpm monorepo (frontend: React/Vite/TypeScript, backend: Node/TypeScript). Main development target.
- `demo/` — standalone demo scripts showing agent usage patterns.
- `src/agentscope/` — upstream AgentScope 2.0 core Python library (参考用，不在此目录开发).

## Build & Development Commands

### Python (core library)

```bash
# Install (from src/agentscope/)
uv pip install -e .           # minimal
uv pip install -e .[dev]      # full + dev tools (pytest, pre-commit, etc.)
uv pip install -e .[full]     # all optional deps (models, service, storage, workspace, tools)

# Run tests (from src/agentscope/)
pytest tests                       # all tests
pytest tests/agent_basic_test.py   # single test file
coverage run -m pytest tests       # with coverage

# Linting (pre-commit hooks)
pre-commit run --all-files    # black, flake8, pylint, mypy, pyroma
```

### Web UI (from `web_ui/`)

```bash
pnpm install
pnpm dev              # concurrent frontend + backend
pnpm dev:frontend     # Vite dev server only
pnpm dev:backend      # backend only
pnpm build            # production build
pnpm format           # prettier + eslint fix
pnpm format:check     # CI check
```

### Agent Service

```bash
cd agent_service
pip install -r requirements.txt   # install dependencies (includes agentscope[full])
cp .env.example .env              # configure admin credentials
python main.py                    # starts FastAPI on port 8300 (requires Redis on localhost:6379)
```

### Service Management

```bash
bash manager.sh start all         # start all services
bash manager.sh restart backend   # restart agent_service only
bash manager.sh status            # check running status
bash manager.sh logs all          # tail all logs
```

## Architecture

### Core Agent Loop (`agent/_agent.py`)

The `Agent` class implements a **ReAct loop** (reasoning-acting):

1. **reply / reply_stream** — public entry points. `reply` returns the final `AssistantMsg`; `reply_stream` yields incremental `AgentEvent`s.
2. Each iteration: call the model (reasoning) → execute tool calls (acting) → repeat until no more tool calls or `max_iters` reached.
3. Context compression kicks in when token usage exceeds `context_config.trigger_ratio` of the model's `context_size`.

The agent is configured via three config objects: `ContextConfig`, `ReActConfig`, `ModelConfig` (in `agent/_config.py`).

### Message & Event System

- **Messages** (`message/`): Pydantic models. `Msg` base with roles `user/assistant/system`. Content is a list of `ContentBlock` types: `TextBlock`, `ThinkingBlock`, `ToolCallBlock`, `ToolResultBlock`, `DataBlock`, `HintBlock`.
- **Events** (`event/`): Streaming deltas emitted during `reply_stream`. `EventType` enum covers the full lifecycle: reply start/end, model call, text/thinking/tool-call/tool-result block deltas, permission prompts, etc.

### Model Providers (`model/`)

All providers extend `ChatModelBase`. Each provider has a paired `Credential` class (`credential/`) and a `Formatter` (`formatter/`) that converts the internal `Msg` format to the provider's API format.

Supported: DashScope (Qwen), OpenAI (Chat + Response API), Anthropic, Gemini, DeepSeek, Moonshot, Ollama, xAI.

### Tool System (`tool/`)

- `ToolBase` — abstract interface with `name`, `description`, `input_schema`, permission flags.
- `Toolkit` — registry that manages tools, tool groups, MCP tools, and skills. Handles tool dispatch and streaming responses.
- Built-in tools: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, plus task management tools (`TaskCreate/Get/List/Update`).
- `FunctionTool` — wraps plain Python functions. `MCPTool` — wraps MCP server tools.
- `ToolGroup` — groups tools that share activation state and instructions.

### Middleware (`middleware/`)

Onion-pattern hooks at 4 levels: `on_reply`, `on_reasoning`, `on_acting`, `on_model_call`. Plus a transformer hook `on_system_prompt`. Extend `MiddlewareBase` and implement only the hooks you need.

### Permission (`permission/`)

`PermissionEngine` evaluates tool calls against `PermissionRule`s in a `PermissionContext`. Modes: `EXPLORE` (read-only), `ACCEPT_EDITS`, `FULL_AUTO`, etc. Bash tools use command parsing; file tools use glob matching.

### Workspace (`workspace/`)

Sandboxed execution environments: `LocalWorkspace`, `DockerWorkspace`, `E2BWorkspace`. Provides file system, MCP servers, skills, and context offloading to agents.

### App Layer (`app/`)

FastAPI service layer. `create_app()` wires together storage (Redis), message bus (Redis), workspace manager, and exposes REST routers for agents, chats, credentials, models, sessions, schedules, and workspaces. Includes AG-UI protocol support.

### Authentication & User System (`agent_service/`)

Department-level user management layered on top of the core library (no changes to `src/agentscope/`).

- **`auth.py`** — JWT (PyJWT/HS256) creation & validation, bcrypt password hashing, `AuthUser` dataclass, `get_current_user()` FastAPI dependency.
- **`auth_router.py`** — Login endpoints:
  - `POST /auth/login` — unified password login (checks Redis credentials first, falls back to env-var admin).
  - `POST /auth/login/token` — employee token login.
  - `POST /auth/set-credentials` — any logged-in user sets their own username/password.
  - `GET /auth/me` — returns current user info + `has_credentials` flag.
- **`user_router.py`** — Employee CRUD (admin only): create, list, delete, regenerate token.
- **`agent_router.py`** — Agent assignment: assign/unassign agents to employees, list assignments.
- **`main.py`** — `AuthMiddleware` validates JWT on all non-`/auth/*` requests, injects `request.state.auth_user`, sets `X-User-ID` header for core library compatibility. OPTIONS requests bypass auth for CORS.

**Redis key patterns (user system):**
- `agentscope:dept_users:{admin_id}:{user_id}` — employee record
- `agentscope:dept_users_index:{admin_id}` — Set of employee user_ids
- `agentscope:dept_tokens:{token}` — token → `{user_id, admin_user_id}`
- `agentscope:dept_credentials:{admin_id}:{username}` — username/password credential
- `agentscope:username_lookup:{username}` — global username → admin_user_id reverse lookup
- `agentscope:agent_assign:{admin_id}:{agent_id}` — agent → assigned employee
- `agentscope:agent_assign_index:{admin_id}:{user_id}` — employee → Set of agent_ids

**Config** (`agent_service/.env`): `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`.

### Frontend Auth (`web_ui/frontend/src/`)

- **`context/AuthContext.tsx`** — `AuthProvider` wraps App, stores JWT in localStorage, `useAuth()` returns `{user, isAdmin, login, logout}`.
- **`api/auth.ts`** — login, token login, set-credentials, me APIs.
- **`api/client.ts`** — sends `Authorization: Bearer <token>` header; 401 auto-logout.
- **`pages/setup/`** — Login page with "Password Login" and "Token Login" tabs.
- **`pages/user/`** — Employee management page (admin only): employee list, token display/copy/regenerate, agent assignment.
- **`components/dialog/SetCredentialsDialog.tsx`** — Set username/password dialog; auto-prompted for employees on first token login.
- **`components/layout/AppSidebar.tsx`** — Role-based navigation: admin sees credential + user management; employee sees chat + schedule only. All users see "set password" button.
- **`components/tour/`** — Role-specific onboarding tours: admin tour includes "create agent" step; employee tour starts with "select agent".

### MCP Integration (`mcp/`)

`MCPClient` supports stdio and HTTP (SSE + streamable HTTP) transports. Can be stateful (persistent session) or stateless (per-call session).

## Code Conventions

- Python 3.11+ required. Async throughout (`async/await`).
- All internal files under `src/agentscope/` use `_` prefix naming; public API is controlled via `__init__.py`.
- Third-party optional deps must be lazy-imported at point of use, not at file top.
- Formatters: black (line-length 79), flake8, pylint, mypy (strict typing).
- Docstrings: Google-style with type annotations in backticks (`` `str` ``). English only.
- PR titles follow Conventional Commits: `feat(scope): description`.
- All new features require unit tests.
