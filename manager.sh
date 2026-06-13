#!/usr/bin/env bash
# dev.sh — AgentScope 2.0 开发服务管理脚本
# 用法: ./dev.sh {start|stop|restart|status} [frontend|backend|all]
#   frontend = web_ui/frontend (vite) + web_ui/backend (express)
#   backend  = agent_service (uvicorn)
#   all      = 以上全部 (默认)
#
# 端口配置 (环境变量，可在 .env 中设置):
#   AGENT_PORT  — agent_service 端口 (默认 8300)
#   NODE_PORT   — node backend 端口  (默认 3000)
#   VITE_PORT   — vite dev 端口      (默认 5173)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 加载 .env (如果存在)
if [ -f "$ROOT_DIR/.env" ]; then
    set -a; source "$ROOT_DIR/.env"; set +a
fi

# ---------- 端口配置 (按需修改) ----------
AGENT_PORT="${AGENT_PORT:-8300}"
NODE_PORT="${NODE_PORT:-3000}"
VITE_PORT="${VITE_PORT:-5173}"

# ---------- Python 环境 (按需修改) ----------
CONDA_ENV="${CONDA_ENV:-cloudagents}"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

PIDFILE_AGENT="$LOG_DIR/agent_service.pid"
PIDFILE_NODE_BE="$LOG_DIR/node_backend.pid"
PIDFILE_FRONTEND="$LOG_DIR/frontend.pid"

# ---------- helpers ----------

_pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

_stop_by_pidfile() {
    local label="$1" pidfile="$2"
    if _pid_alive "$pidfile"; then
        local pid; pid=$(cat "$pidfile")
        # kill process tree: find children, then kill parent
        pkill -P "$pid" 2>/dev/null || true
        kill "$pid" 2>/dev/null || true
        rm -f "$pidfile"
        echo "[$label] stopped (pid $pid)"
    else
        rm -f "$pidfile"
        echo "[$label] not running"
    fi
}

_status() {
    local label="$1" pidfile="$2" port="$3"
    if _pid_alive "$pidfile"; then
        echo "[$label] running (pid $(cat "$pidfile"), port $port)"
    else
        rm -f "$pidfile"
        echo "[$label] stopped"
    fi
}

# ---------- start ----------

start_agent_service() {
    if _pid_alive "$PIDFILE_AGENT"; then
        echo "[agent_service] already running (pid $(cat "$PIDFILE_AGENT"))"
        return
    fi
    echo "[agent_service] starting on :$AGENT_PORT ..."
    cd "$ROOT_DIR/agent_service"
    nohup bash -c "eval \"\$(conda shell.bash hook 2>/dev/null)\" && conda activate $CONDA_ENV && env AGENT_PORT=$AGENT_PORT python main.py" > "$LOG_DIR/agent_service.log" 2>&1 &
    echo $! > "$PIDFILE_AGENT"
    echo "[agent_service] started (pid $!), log: $LOG_DIR/agent_service.log"
}

start_node_backend() {
    if _pid_alive "$PIDFILE_NODE_BE"; then
        echo "[node_backend] already running (pid $(cat "$PIDFILE_NODE_BE"))"
        return
    fi
    echo "[node_backend] starting on :$NODE_PORT ..."
    cd "$ROOT_DIR/web_ui"
    nohup env PORT="$NODE_PORT" pnpm dev:backend > "$LOG_DIR/node_backend.log" 2>&1 &
    echo $! > "$PIDFILE_NODE_BE"
    echo "[node_backend] started (pid $!), log: $LOG_DIR/node_backend.log"
}

start_frontend() {
    if _pid_alive "$PIDFILE_FRONTEND"; then
        echo "[frontend] already running (pid $(cat "$PIDFILE_FRONTEND"))"
        return
    fi
    echo "[frontend] starting on :$VITE_PORT ..."
    cd "$ROOT_DIR/web_ui"
    nohup env VITE_PORT="$VITE_PORT" pnpm dev:frontend -- --port "$VITE_PORT" > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$PIDFILE_FRONTEND"
    echo "[frontend] started (pid $!), log: $LOG_DIR/frontend.log"
}

# ---------- actions ----------

do_start() {
    case "${1:-all}" in
        frontend) start_node_backend; start_frontend ;;
        backend)  start_agent_service ;;
        all)      start_agent_service; start_node_backend; start_frontend ;;
        *) echo "unknown target: $1"; exit 1 ;;
    esac
}

do_stop() {
    case "${1:-all}" in
        frontend)
            _stop_by_pidfile "frontend" "$PIDFILE_FRONTEND"
            _stop_by_pidfile "node_backend" "$PIDFILE_NODE_BE" ;;
        backend)
            _stop_by_pidfile "agent_service" "$PIDFILE_AGENT" ;;
        all)
            _stop_by_pidfile "frontend" "$PIDFILE_FRONTEND"
            _stop_by_pidfile "node_backend" "$PIDFILE_NODE_BE"
            _stop_by_pidfile "agent_service" "$PIDFILE_AGENT" ;;
        *) echo "unknown target: $1"; exit 1 ;;
    esac
}

do_status() {
    _status "agent_service" "$PIDFILE_AGENT" "$AGENT_PORT"
    _status "node_backend"  "$PIDFILE_NODE_BE" "$NODE_PORT"
    _status "frontend"      "$PIDFILE_FRONTEND" "$VITE_PORT"
}

do_restart() {
    do_stop "${1:-all}"
    sleep 1
    do_start "${1:-all}"
}

do_logs() {
    local target="${1:-all}"
    case "$target" in
        frontend)      tail -f "$LOG_DIR/frontend.log" ;;
        backend)       tail -f "$LOG_DIR/agent_service.log" "$LOG_DIR/node_backend.log" ;;
        agent)         tail -f "$LOG_DIR/agent_service.log" ;;
        node)          tail -f "$LOG_DIR/node_backend.log" ;;
        all)           tail -f "$LOG_DIR"/*.log ;;
        *) echo "unknown target: $target"; exit 1 ;;
    esac
}

# ---------- main ----------

ACTION="${1:-}"
TARGET="${2:-all}"

case "$ACTION" in
    start)   do_start "$TARGET" ;;
    stop)    do_stop "$TARGET" ;;
    restart) do_restart "$TARGET" ;;
    status)  do_status ;;
    logs)    do_logs "$TARGET" ;;
    *)
        echo "AgentScope 2.0 Dev Manager"
        echo ""
        echo "用法: $0 {start|stop|restart|status|logs} [frontend|backend|all]"
        echo ""
        echo "  start   [target]  启动服务"
        echo "  stop    [target]  停止服务"
        echo "  restart [target]  重启服务"
        echo "  status            查看所有服务状态"
        echo "  logs    [target]  查看日志 (target: frontend|backend|agent|node|all)"
        echo ""
        echo "  target 默认为 all"
        echo "  frontend 包含 vite(:$VITE_PORT) + node_backend(:$NODE_PORT)"
        echo "  backend  包含 agent_service(:$AGENT_PORT)"
        echo ""
        echo "  端口可通过环境变量或 .env 文件配置:"
        echo "    AGENT_PORT=$AGENT_PORT  NODE_PORT=$NODE_PORT  VITE_PORT=$VITE_PORT"
        exit 1
        ;;
esac
