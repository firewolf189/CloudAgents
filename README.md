# CloudAgents

基于 AgentScope 2.0 的多 Agent 管理平台，提供 Web UI 进行 Agent 创建、对话、工具管理等操作。

## 项目结构

```
├── agent_service/      # Python 后端服务（FastAPI + Redis）
├── web_ui/             # 前端（React/Vite）+ Node.js 后端
│   ├── frontend/       # React + TypeScript + Tailwind CSS
│   └── backend/        # Node.js 中间层
├── src/agentscope/     # AgentScope 2.0 核心库（依赖）
├── docs/               # 设计文档
├── logo/               # Logo 资源
├── demo/               # 示例脚本
└── manager.sh          # 一键启停脚本
```

## 环境要求

| 依赖 | 版本 |
|------|------|
| Python | >= 3.11 |
| Node.js | >= 18 |
| pnpm | >= 8 |
| Redis | >= 6 |
| Conda（推荐） | 任意版本 |

## 快速部署

### 1. 克隆仓库

```bash
git clone https://github.com/firewolf189/CloudAgents.git
cd CloudAgents
```

### 2. 安装 AgentScope 核心库

```bash
cd src/agentscope
conda create -n agentscope python=3.11 -y
conda activate agentscope
uv pip install -e .[full]
cd ../..
```

### 3. 启动 Redis

```bash
# macOS
brew install redis
brew services start redis

# Linux
sudo apt install redis-server
sudo systemctl start redis
```

确认 Redis 运行在 `localhost:6379`。

### 4. 启动后端服务（agent_service）

```bash
conda activate agentscope
cd agent_service
python main.py
```

服务启动在 `http://localhost:8300`。

### 5. 安装并启动前端

```bash
cd web_ui
pnpm install
pnpm dev
```

- 前端：`http://localhost:5173`
- Node 后端：`http://localhost:3000`

### 6. 访问

浏览器打开 `http://localhost:5173`，输入服务器地址 `http://localhost:8300` 和用户名即可使用。

## 一键管理

项目提供 `manager.sh` 脚本，支持一键启停所有服务：

```bash
# 启动所有服务
bash manager.sh start all

# 停止所有服务
bash manager.sh stop all

# 重启所有服务
bash manager.sh restart all

# 仅操作后端 / 前端
bash manager.sh start backend
bash manager.sh restart frontend

# 查看状态
bash manager.sh status

# 查看日志
bash manager.sh logs all
```

> `manager.sh` 默认使用 conda 环境 `agentscope`，可通过环境变量 `CONDA_ENV` 修改。

## 端口配置

| 服务 | 默认端口 | 环境变量 |
|------|----------|----------|
| agent_service | 8300 | `AGENT_PORT` |
| Node 后端 | 3000 | `NODE_PORT` |
| Vite 前端 | 5173 | `VITE_PORT` |

可在项目根目录创建 `.env` 文件覆盖：

```env
AGENT_PORT=8300
NODE_PORT=3000
VITE_PORT=5173
CONDA_ENV=agentscope
```

## 模型配置

首次使用需要在「凭证」页面添加模型供应商的 API Key。支持的供应商：

- DashScope（通义千问）
- OpenAI
- Anthropic
- Gemini
- DeepSeek
- Moonshot
- Ollama
- xAI
