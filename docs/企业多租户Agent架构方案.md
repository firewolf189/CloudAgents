# 企业多租户 Agent 架构方案

> 基于 AgentScope 2.0 构建公司级多层级、多租户隔离的智能体系统

## 1. 架构概述

本方案采用**管理平面 + 部门后端**架构：管理平面统一管控组织、路由与跨部门编排，各部门独立部署 AgentScope 服务实现数据物理隔离。跨部门任务由管理平面的编排层直接调用各部门 API 完成，无需独立的公司 Agent 后端。

```
┌───────────────────────────────────────────────┐
│                 管理平面                        │
│  ┌─────────────────────────────────────────┐  │
│  │  组织管理服务                              │  │
│  │  ├─ 组织树（公司 → 部门 → 员工）            │  │
│  │  ├─ Agent 分配（RBAC：谁能用哪个 agent）    │  │
│  │  ├─ JWT 鉴权（统一签发 token）              │  │
│  │  ├─ 路由网关（请求分发到对应部门后端）        │  │
│  │  └─ 跨部门编排（代码调用各部门 API）         │  │
│  └─────────────────────────────────────────┘  │
└──────────┬──────────────┬──────────────┬──────┘
           │              │              │
           ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  研发部后端   │ │  市场部后端    │ │  财务部后端    │
│  AgentScope  │ │  AgentScope  │ │  AgentScope  │
│  Redis-A     │ │  Redis-B     │ │  Redis-C     │
│              │ │              │ │              │
│  部门Agent   │ │  部门Agent    │ │  部门Agent    │
│  代码助手    │ │  文案助手      │ │  报表助手      │
│  运维助手    │ │  数据分析      │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

**为什么不需要公司后端**：跨部门编排（如"汇总各部门周报"）是确定性流程，管理平面用代码并发调各部门 API 即可，不需要 LLM 推理决策，省掉一套后端和一个 Redis。

## 2. 两层职责划分

| 层 | 技术 | 职责 |
|---|------|------|
| **管理平面** | 自建服务（FastAPI / Spring 等） | 组织树、JWT 鉴权、Agent 分配、路由网关、跨部门编排 |
| **部门后端** | AgentScope 2.0（每部门独立实例） | 部门内 agent 运行、数据存储、工具执行、团队协作 |

## 3. Agent 层级设计

### 3.1 层级结构

```
公司
├── 管理平面（跨部门编排，代码实现，无需 Agent）
│
├── 研发部（独立后端 research-svc:8300）
│   ├── 部门Agent（能调度本部门所有 agent）
│   ├── 张三 → 代码助手、运维助手
│   └── 李四 → 测试助手
│
├── 市场部（独立后端 marketing-svc:8300）
│   ├── 部门Agent（能调度本部门所有 agent）
│   ├── 王五 → 文案助手
│   └── 赵六 → 数据分析助手
│
└── 财务部（独立后端 finance-svc:8300）
    ├── 部门Agent
    └── ...
```

### 3.2 Agent 类型与权限

| Agent 类型 | PermissionMode | 能力范围 |
|-----------|---------------|---------|
| 部门Agent | ACCEPT_EDITS | 部门内协调，可通过 Team 功能调度本部门所有 agent |
| 个人Agent（编辑类） | ACCEPT_EDITS | 限定工作目录内的文件操作 |
| 个人Agent（只读类） | EXPLORE | 只读，适合探索和分析任务 |
| 实习生Agent | DEFAULT | 每步操作需确认 |

## 4. 数据隔离模型

### 4.1 物理隔离

每个部门独立部署，拥有独立的数据存储：

```
研发部后端
├── Redis-B（独立实例）
│   ├── AgentRecord      ← 研发部的 agent 配置
│   ├── SessionRecord    ← 研发部的会话状态
│   ├── CredentialRecord ← 研发部的 API Key
│   ├── Msg              ← 研发部的聊天记录
│   └── MessageBus       ← 研发部的运行时通信
│
├── Workspace（文件系统）
│   ├── {agent_id_1}/    ← 代码助手的工具/MCP/Skill
│   ├── {agent_id_2}/    ← 运维助手的工具/MCP/Skill
│   └── {agent_id_3}/    ← 测试助手的工具/MCP/Skill
```

### 4.2 隔离层级汇总

| 隔离维度 | 机制 | 隔离效果 |
|---------|------|---------|
| 部门间 | 独立后端 + 独立 Redis | 物理隔离，互不可见 |
| 员工间 | AgentScope user_id | 同部门内按用户隔离 |
| Agent 间 | AgentScope agent_id + workspace | 独立工作目录和工具集 |
| 会话间 | AgentScope session_id | 独立对话上下文和权限规则 |

## 5. 跨部门编排

### 5.1 设计思路

跨部门编排由管理平面的**编排层**用代码直接调用各部门 API，不需要 LLM 推理决策。典型场景如汇总周报、跨部门数据查询等都是确定性流程。

### 5.2 编排层实现

```python
"""管理平面的跨部门编排服务"""
import asyncio
import json
import httpx

# 部门后端注册表
DEPARTMENT_ENDPOINTS = {
    "research": {
        "url": "http://research-svc:8300",
        "name": "研发部",
    },
    "marketing": {
        "url": "http://marketing-svc:8300",
        "name": "市场部",
    },
    "finance": {
        "url": "http://finance-svc:8300",
        "name": "财务部",
    },
}


async def call_department_agent(
    department: str,
    task: str,
    agent_id: str | None = None,
    caller_id: str = "company-admin",
) -> str:
    """向指定部门的 Agent 发送任务并等待结果。

    Args:
        department: 部门标识（research / marketing / finance）
        task: 任务描述
        agent_id: 目标 agent_id，不填则使用部门第一个 Agent
        caller_id: 调用者标识，作为 X-User-ID

    Returns:
        Agent 的文本回复
    """
    dept = DEPARTMENT_ENDPOINTS[department]
    base_url = dept["url"]
    headers = {"X-User-ID": caller_id, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=120) as client:
        # 1. 获取目标 agent_id
        if not agent_id:
            resp = await client.get(f"{base_url}/agent/", headers=headers)
            agents = resp.json().get("agents", [])
            if not agents:
                return f"{dept['name']}没有可用的Agent"
            agent_id = agents[0]["id"]

        # 2. 创建临时 session
        resp = await client.post(
            f"{base_url}/sessions/",
            headers=headers,
            json={"agent_id": agent_id},
        )
        session_id = resp.json()["session"]["id"]

        # 3. 发送任务
        await client.post(
            f"{base_url}/chat/",
            headers=headers,
            json={
                "agent_id": agent_id,
                "session_id": session_id,
                "input": {
                    "name": "管理平面",
                    "role": "user",
                    "content": [{"type": "text", "text": task}],
                },
            },
        )

        # 4. 监听 SSE 收集结果
        result_text = []
        async with client.stream(
            "GET",
            f"{base_url}/sessions/{session_id}/stream",
            headers=headers,
            params={"agent_id": agent_id},
        ) as stream:
            async for line in stream.aiter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                if event.get("type") == "TEXT_BLOCK_DELTA":
                    result_text.append(event["delta"])
                elif event.get("type") == "REPLY_END":
                    break

        # 5. 清理临时 session
        await client.delete(
            f"{base_url}/sessions/{session_id}",
            headers=headers,
            params={"agent_id": agent_id},
        )

    return "".join(result_text) or "（未获取到回复）"


async def generate_company_weekly_report() -> dict:
    """并发调用各部门 Agent，汇总公司周报。"""
    tasks = {
        dept: call_department_agent(dept, "总结本周工作进展，200字以内")
        for dept in DEPARTMENT_ENDPOINTS
    }
    results = {}
    for dept, coro in tasks.items():
        results[dept] = await coro  # 也可用 asyncio.gather 并发
    return results
```

### 5.3 暴露为管理平面 API

```python
"""管理平面 main.py（FastAPI）"""
from fastapi import FastAPI

app = FastAPI(title="企业Agent管理平面")


@app.post("/orchestrate/weekly-report")
async def weekly_report():
    """跨部门汇总周报"""
    results = await generate_company_weekly_report()
    return {"departments": results}


@app.post("/orchestrate/call-department")
async def call_department(department: str, task: str, agent_id: str = None):
    """调用指定部门的 Agent 执行任务"""
    result = await call_department_agent(department, task, agent_id)
    return {"department": department, "result": result}
```

## 6. 管理平面设计

管理平面是需要自建的部分，不依赖 AgentScope，负责组织架构和访问控制。

### 6.1 数据模型

```
Organization（公司）
├── id, name
│
├── Department（部门）
│   ├── id, name, org_id
│   ├── backend_url          ← 对应的 AgentScope 后端地址
│   └── default_agent_id     ← 部门默认 Agent
│
├── Employee（员工）
│   ├── id, name, department_id
│   ├── role (admin / manager / member / intern)
│   └── jwt_token
│
└── AgentAssignment（Agent 分配）
    ├── employee_id
    ├── agent_id
    ├── department_id
    └── permission_mode      ← 该员工对该 agent 的权限级别
```

### 6.2 路由网关

网关根据 JWT 中的部门信息，将请求转发到对应的部门后端：

```python
"""路由网关伪代码"""

async def route_request(request):
    token = request.headers["Authorization"]
    payload = decode_jwt(token)

    department = payload["department"]
    user_id = payload["user_id"]
    role = payload["role"]

    # 查找部门对应的后端地址
    backend_url = get_department_backend(department)

    # 检查该用户是否有权访问请求中的 agent
    agent_id = request.json.get("agent_id")
    if not check_agent_access(user_id, agent_id, role):
        raise HTTPException(403, "无权访问该 Agent")

    # 转发请求，替换 X-User-ID
    response = await forward(
        backend_url,
        request,
        headers={"X-User-ID": user_id},
    )
    return response
```

### 6.3 鉴权集成

每个部门后端替换默认的 `get_current_user_id`，接入统一的 JWT 验证：

```python
"""每个部门后端的鉴权配置"""
from agentscope.app.deps import get_current_user_id as default_dep

async def jwt_auth(authorization: str = Header(...)) -> str:
    payload = decode_jwt(authorization.removeprefix("Bearer "))
    return payload["user_id"]

app.dependency_overrides[default_dep] = jwt_auth
```

## 7. 部门后端部署

### 7.1 单个部门的部署配置

```python
"""研发部后端 main.py"""
import os
import uvicorn
from fastapi.middleware import Middleware
from fastapi.middleware.cors import CORSMiddleware

from agentscope.app import create_app, SubAgentTemplate
from agentscope.app.storage import RedisStorage
from agentscope.app.message_bus import RedisMessageBus
from agentscope.app.workspace_manager import LocalWorkspaceManager
from agentscope.permission import PermissionContext, PermissionMode

app = create_app(
    storage=RedisStorage(
        host="redis-research",  # 研发部独立 Redis
        port=6379,
    ),
    message_bus=RedisMessageBus(
        host="redis-research",
        port=6379,
    ),
    workspace_manager=LocalWorkspaceManager(
        basedir="/data/research/workspaces",
        default_mcps=[],
    ),
    custom_subagent_templates=[
        SubAgentTemplate(
            type="explorer",
            description="只读探索Agent，用于代码审查和分析",
            system_prompt_template=(
                "你是{member_name}，研发部的代码探索专家。"
                "你的职责：{member_description}\n"
                "注���：你只能读取和分析，不能修改任何文件。"
            ),
            permission_context=PermissionContext(
                mode=PermissionMode.EXPLORE,
            ),
        ),
        SubAgentTemplate(
            type="coder",
            description="编码Agent，可以修改代码",
            system_prompt_template=(
                "你是{member_name}，研发部的编码专家。"
                "你的职责：{member_description}\n"
                "你可以在工作目录内创建和修改文件。"
            ),
            permission_context=PermissionContext(
                mode=PermissionMode.ACCEPT_EDITS,
            ),
        ),
    ],
    extra_middlewares=[
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        ),
    ],
)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8300)
```

### 7.2 Docker Compose 部署示例

```yaml
# docker-compose.yml
version: "3.9"

services:
  # ============ 管理平面（网关 + 编排） ============
  gateway:
    build: ./gateway
    ports:
      - "8080:8080"
    environment:
      - JWT_SECRET=your-secret-key
      - RESEARCH_BACKEND=http://research-svc:8300
      - MARKETING_BACKEND=http://marketing-svc:8300
      - FINANCE_BACKEND=http://finance-svc:8300

  # ============ 研发部后端 ============
  research-redis:
    image: redis:7-alpine
    volumes:
      - research-redis-data:/data

  research-svc:
    build: ./research-backend
    ports:
      - "8301:8300"
    environment:
      - REDIS_HOST=research-redis
    depends_on:
      - research-redis

  # ============ 市场部后端 ============
  marketing-redis:
    image: redis:7-alpine
    volumes:
      - marketing-redis-data:/data

  marketing-svc:
    build: ./marketing-backend
    ports:
      - "8302:8300"
    environment:
      - REDIS_HOST=marketing-redis
    depends_on:
      - marketing-redis

  # ============ 财务部后端 ============
  finance-redis:
    image: redis:7-alpine
    volumes:
      - finance-redis-data:/data

  finance-svc:
    build: ./finance-backend
    ports:
      - "8303:8300"
    environment:
      - REDIS_HOST=finance-redis
    depends_on:
      - finance-redis

  # ============ 前端 ============
  web-ui:
    build: ./web-ui
    ports:
      - "5173:5173"

volumes:
  research-redis-data:
  marketing-redis-data:
  finance-redis-data:
```

## 8. 调用链路示例

### 8.1 员工日常使用

```
员工张三打开前端
  → 前端连接 gateway:8080
  → JWT 鉴权，识别为研发部员工
  → 网关转发到 research-svc:8300
  → 张三看到自己被分配的 agent（代码助手、运维助手）
  → 选择代码助手开始聊天
  → POST /chat → SSE 事件流 → 前端渲染
```

### 8.2 跨部门编排（管理平面代码调用）

```
管理层收到请求："汇总各部门本周工作进展"

管理平面编排层（代码，非 LLM）：
  ├─ 并发调用 call_department_agent("research", "总结本周研发进展")
  │   → POST research-svc:8300/chat/
  │   → 研发部Agent执行，返回研发进展摘要
  │
  ├─ 并发调用 call_department_agent("marketing", "总结本周市场活动")
  │   → POST marketing-svc:8300/chat/
  │   → 市场部Agent执行，返回市场活动摘要
  │
  └─ 代码拼接所有部门反馈，返回给调用方
```

### 8.3 部门内团队协作

```
研发经理对部门Agent说："审查 feature-x 分支的代码并修复发现的问题"

部门Agent 推理：
  ├─ TeamCreate("代码审查团队")
  ├─ AgentCreate(type="explorer", name="审查员", task="审查 feature-x 代码")
  ├─ 等待审查员通过 TeamSay 汇报发现的问题
  ├─ AgentCreate(type="coder", name="修复员", task="修复以下问题：...")
  └─ 汇总结果回复经理
```

## 9. 安全考量

### 9.1 网络隔离

```
                    ┌─ DMZ ──────────────┐
                    │  Gateway (8080)    │
                    │  Web UI (5173)     │
                    └────────┬───────────┘
                             │
                    ┌─ 内网 ──┴───────────────────────┐
                    │                                  │
                    │  研发后端    市场后端    财务后端    │
                    │  (8301)    (8302)     (8303)     │
                    │                                  │
                    │  Redis-A   Redis-B    Redis-C    │
                    └──────────────────────────────────┘
```

- 只有 Gateway 和 Web UI 暴露在 DMZ
- 各部门后端仅在内网通信
- 跨部门调用只能通过管理平面的编排层发起，部门间不直接互访

### 9.2 权限控制清单

| 控制点 | 机制 | 说明 |
|--------|------|------|
| 用户身份 | JWT 鉴权 | 管理平面统一签发 |
| Agent 访问 | RBAC | 管理平面控制谁能用哪个 agent |
| 工具执行 | AgentScope PermissionMode | 按 agent 类型配置不同权限级别 |
| 敏感操作 | AgentScope 危险路径保护 | .env/.ssh 等文件操作自动拦截 |
| 跨部门调用 | 管理平面编排层 | 代码直接调用各部门 API，无需 LLM |
| 数据隔离 | 独立 Redis | 部门间数据物理隔离 |

### 9.3 审计日志

通过 AgentScope 的 `TracingMiddleware` + OpenTelemetry 实现全链路追踪：

```python
from agentscope.middleware import TracingMiddleware

app = create_app(
    ...,
    extra_agent_middlewares=lambda uid, aid, sid: [
        TracingMiddleware(),
    ],
)
```

每次 agent 调用会产生嵌套 span 树，记录：
- 谁（user_id）调用了哪个 agent
- agent 调用了什么工具、传了什么参数
- 模型消耗了多少 token
- 整个调用链的耗时

## 10. 扩展方向

### 10.1 长期记忆

AgentScope 当前只有会话级记忆（上下文压缩）。企业场景的长期记忆可通过 middleware 扩展：

```python
class EnterpriseMemoryMiddleware(MiddlewareBase):
    """在每次推理前注入企业知识库的相关内容"""

    async def on_system_prompt(self, agent, current_prompt):
        # 从向量数据库检索相关的企业知识
        context = agent.state.context
        latest_msg = context[-1] if context else None
        if latest_msg:
            memories = await vector_db.search(latest_msg.get_text_content())
            return f"{current_prompt}\n\n## 相关企业知识\n{memories}"
        return current_prompt
```

### 10.2 工作区隔离策略

默认按 agent 隔离，可按需切换为按用户或按会话隔离：

| 策略 | 适用场景 |
|------|---------|
| 按 agent（默认） | 同 agent 的所有会话共享工具和文件 |
| 按用户 | 每个员工有独立的工作空间 |
| 按会话 | 每次对话完全隔离，适合敏感场景 |

### 10.3 沙箱执行

敏感部门可使用 Docker 或 E2B 沙箱替代本地文件系统：

```python
from agentscope.app.workspace_manager import DockerWorkspaceManager

workspace_manager = DockerWorkspaceManager(
    basedir="/data/docker-workspaces",
)
```

## 11. 总结

| 维度 | 方案 |
|------|------|
| 架构模式 | 管理平面（编排 + 路由） + 部门后端（物理隔离） |
| Agent 层级 | 部门Agent → 个人Agent（两级），跨部门由管理平面代码编排 |
| 数据隔离 | 每部门独立 Redis + 独立 Workspace |
| 跨部门协作 | 管理平面编排层直接调用各部门 API（确定性流程，无需 LLM） |
| 部门内协作 | AgentScope 原生 Agent Team 功能 |
| 鉴权 | 管理平面 JWT + 网关路由 |
| 权限控制 | AgentScope PermissionMode（按 agent 类型配置） |
| 可观测性 | TracingMiddleware + OpenTelemetry |
| 部署方式 | Docker Compose / Kubernetes |
| 需要自建 | 管理平面（组织树 + RBAC + 网关 + 编排层） |
| 直接复用 | AgentScope 全部能力（agent 运行时、工具、权限、团队、调度） |
