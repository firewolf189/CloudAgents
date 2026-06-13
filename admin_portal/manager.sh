#!/usr/bin/env bash
# admin_portal/manager.sh — 管理平面服务管理脚本
# 用法: ./manager.sh {start|stop|restart|status|logs} [backend|frontend|all]

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$ROOT_DIR/.env" ]; then
    set -a; source "$ROOT_DIR/.env"; set +a
fi

PORTAL_PORT="${PORTAL_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5180}"
CONDA_ENV="${CONDA_ENV:-cloudagents}"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

PIDFILE_BACKEND="$LOG_DIR/backend.pid"
PIDFILE_FRONTEND="$LOG_DIR/frontend.pid"

_pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

_stop_by_pidfile() {
    local label="$1" pidfile="$2"
    if _pid_alive "$pidfile"; then
        local pid; pid=$(cat "$pidfile")
        pkill -P "$pid" 2>/dev/null || true
        kill "$pid" 2>/dev/null || true
        for i in 1 2 3 4 5; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 1
        done
        kill -9 "$pid" 2>/dev/null || true
        rm -f "$pidfile"
        echo "[$label] stopped (pid $pid)"
    else
        rm -f "$pidfile"
        echo "[$label] not running"
    fi
}

_kill_port() {
    local port="$1"
    local pids; pids=$(lsof -ti:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
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

start_backend() {
    if _pid_alive "$PIDFILE_BACKEND"; then
        echo "[backend] already running (pid $(cat "$PIDFILE_BACKEND"))"
        return
    fi
    echo "[backend] starting on :$PORTAL_PORT ..."
    cd "$ROOT_DIR/backend"
    nohup bash -c "eval \"\$(conda shell.bash hook 2>/dev/null)\" && conda activate $CONDA_ENV && env PORTAL_PORT=$PORTAL_PORT python main.py" > "$LOG_DIR/backend.log" 2>&1 &
    echo $! > "$PIDFILE_BACKEND"
    echo "[backend] started (pid $!), log: $LOG_DIR/backend.log"
}

start_frontend() {
    if _pid_alive "$PIDFILE_FRONTEND"; then
        echo "[frontend] already running (pid $(cat "$PIDFILE_FRONTEND"))"
        return
    fi
    echo "[frontend] starting on :$FRONTEND_PORT ..."
    cd "$ROOT_DIR/frontend"
    nohup pnpm dev -- --port "$FRONTEND_PORT" --host > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$PIDFILE_FRONTEND"
    echo "[frontend] started (pid $!), log: $LOG_DIR/frontend.log"
}

do_start() {
    case "${1:-all}" in
        backend)  start_backend ;;
        frontend) start_frontend ;;
        all)      start_backend; start_frontend ;;
        *) echo "unknown target: $1"; exit 1 ;;
    esac
}

do_stop() {
    case "${1:-all}" in
        backend)
            _stop_by_pidfile "backend" "$PIDFILE_BACKEND"
            _kill_port "$PORTAL_PORT" ;;
        frontend)
            _stop_by_pidfile "frontend" "$PIDFILE_FRONTEND"
            _kill_port "$FRONTEND_PORT" ;;
        all)
            _stop_by_pidfile "frontend" "$PIDFILE_FRONTEND"
            _kill_port "$FRONTEND_PORT"
            _stop_by_pidfile "backend" "$PIDFILE_BACKEND"
            _kill_port "$PORTAL_PORT" ;;
        *) echo "unknown target: $1"; exit 1 ;;
    esac
}

do_status() {
    _status "backend"  "$PIDFILE_BACKEND"  "$PORTAL_PORT"
    _status "frontend" "$PIDFILE_FRONTEND" "$FRONTEND_PORT"
}

do_restart() {
    do_stop "${1:-all}"
    sleep 2
    do_start "${1:-all}"
}

do_logs() {
    case "${1:-all}" in
        backend)  tail -f "$LOG_DIR/backend.log" ;;
        frontend) tail -f "$LOG_DIR/frontend.log" ;;
        all)      tail -f "$LOG_DIR"/*.log ;;
        *) echo "unknown target: $1"; exit 1 ;;
    esac
}

ACTION="${1:-}"
TARGET="${2:-all}"

case "$ACTION" in
    start)   do_start "$TARGET" ;;
    stop)    do_stop "$TARGET" ;;
    restart) do_restart "$TARGET" ;;
    status)  do_status ;;
    logs)    do_logs "$TARGET" ;;
    *)
        echo "Admin Portal Manager"
        echo ""
        echo "用法: $0 {start|stop|restart|status|logs} [backend|frontend|all]"
        echo ""
        echo "  端口: backend=$PORTAL_PORT  frontend=$FRONTEND_PORT"
        echo "  conda: $CONDA_ENV"
        exit 1
        ;;
esac
