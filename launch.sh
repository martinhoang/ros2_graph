#!/usr/bin/env bash
# Launch script for ROS2 Graph Viewer
# Provides backend (Python + uv) and frontend (Vite dev server) startup.
# Safe, configurable, and conservative: will NOT kill unrelated processes
# bound to the same ports unless --force-ports is passed.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

BACKEND_PORT_DEFAULT=5000
FRONTEND_PORT_DEFAULT=3000

# Defaults (can be overridden by CLI flags)
SYNC_BACKEND=1
FORCE_PORTS=0
BACKEND_PORT=$BACKEND_PORT_DEFAULT
FRONTEND_PORT=$FRONTEND_PORT_DEFAULT
QUIET=0

usage() {
    cat <<EOF
Usage: $0 [options]

Options:
    --no-sync            Skip 'uv sync' for backend dependencies
    --force-ports        Kill any existing processes listening on backend/frontend ports
    --backend-port PORT  Override backend port (default: $BACKEND_PORT_DEFAULT)
    --frontend-port PORT Override frontend port (default: $FRONTEND_PORT_DEFAULT)
    --quiet              Reduce non-essential output
    -h, --help           Show this help and exit

Environment:
    Requires ROS2 environment sourced (ROS_DISTRO set) and 'uv', 'npm' available.
EOF
}

log() { [ "$QUIET" -eq 1 ] && return 0; echo -e "$*"; }
log_err() { echo -e "\e[31m$*\e[0m" >&2; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-sync) SYNC_BACKEND=0; shift ;;
        --force-ports) FORCE_PORTS=1; shift ;;
        --backend-port) BACKEND_PORT="$2"; shift 2 ;;
        --frontend-port) FRONTEND_PORT="$2"; shift 2 ;;
        --quiet) QUIET=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) log_err "Unknown option: $1"; usage; exit 1 ;;
    esac
done

log "Starting ROS2 Graph Viewer..."

# Detect installed vs source layout
if [ -f "$SCRIPT_DIR/../../share/ros2_graph/backend/pyproject.toml" ]; then
    BACKEND_DIR="$SCRIPT_DIR/../../share/ros2_graph/backend"
    WEBAPP_DIR="$SCRIPT_DIR/../../share/ros2_graph/webapp"
    log "Layout: installed (ros2 run)"
elif [ -f "$SCRIPT_DIR/backend/pyproject.toml" ]; then
    BACKEND_DIR="$SCRIPT_DIR/backend"
    WEBAPP_DIR="$SCRIPT_DIR/webapp"
    log "Layout: source checkout"
else
    log_err "Cannot locate backend directory (pyproject.toml)";
    log_err "Checked: $SCRIPT_DIR/backend and install/share path";
    exit 1
fi

log "Backend dir: $BACKEND_DIR"
log "Webapp dir : $WEBAPP_DIR"

if [ -z "${ROS_DISTRO:-}" ]; then
    log_err "ROS2 environment not sourced (ROS_DISTRO unset).";
    log_err "Source e.g.: source /opt/ros/<distro>/setup.bash && source <your_ws>/install/setup.bash";
    exit 1
fi
log "ROS2 distro: $ROS_DISTRO"

command -v uv >/dev/null 2>&1 || { log_err "'uv' not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
command -v npm >/dev/null 2>&1 || { log_err "'npm' not found. Please install Node.js."; exit 1; }

# Ports safety: only kill processes we start unless forced.
ensure_port_free() {
    local port="$1" label="$2"
    if lsof -Pi ":$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
        if [ "$FORCE_PORTS" -eq 1 ]; then
            log "Port $port ($label) busy. Forcing release..."
            lsof -ti ":$port" | xargs -r kill -9 2>/dev/null || true
            sleep 1
        else
            log_err "Port $port ($label) is in use. Use --force-ports to free it."; exit 1
        fi
    fi
}

ensure_port_free "$BACKEND_PORT" "backend"
ensure_port_free "$FRONTEND_PORT" "frontend"

if [ "$SYNC_BACKEND" -eq 1 ]; then
    log "Syncing backend dependencies (uv sync)..."
    (cd "$BACKEND_DIR" && uv sync)
else
    log "Skipping backend dependency sync (--no-sync)"
fi

if [ ! -d "$WEBAPP_DIR/node_modules" ]; then
    log "Installing frontend dependencies (npm install)..."
    (cd "$WEBAPP_DIR" && npm install)
else
    log "Frontend dependencies already installed"
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    local code=$?
    log "\nStopping servers (exit code $code)..."
    # Graceful termination of known child processes
    for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
        if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
            kill "${pid}" 2>/dev/null || true
        fi
    done
    # Small grace period
    sleep 1
    # Force kill if still alive
    for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
        if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
            kill -9 "${pid}" 2>/dev/null || true
        fi
    done
    # As a last resort free ports if --force-ports was used
    if [ "$FORCE_PORTS" -eq 1 ]; then
        for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
            if lsof -Pi ":$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
                lsof -ti ":$port" | xargs -r kill -9 2>/dev/null || true
            fi
        done
    fi
    log "Cleanup complete."
}

trap cleanup SIGINT SIGTERM EXIT

log "Starting backend server (port $BACKEND_PORT)..."
(cd "$BACKEND_DIR" && UV_PORT="$BACKEND_PORT" uv run python ros2_graph_server.py --port "$BACKEND_PORT") &
BACKEND_PID=$!

# Active wait for backend availability (max 10s)
BACKEND_READY=0
for i in $(seq 1 20); do
    if curl -fsS "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
        BACKEND_READY=1; break
    fi
    sleep 0.5
done
if [ "$BACKEND_READY" -ne 1 ]; then
    log_err "Backend did not become healthy on port $BACKEND_PORT. Performing cleanup of possible stale listener."
    # Attempt to kill any process that might have bound the port within our group
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill -TERM "$BACKEND_PID" 2>/dev/null || true
        sleep 0.5
        kill -KILL "$BACKEND_PID" 2>/dev/null || true
    fi
    # If still busy and --force-ports provided, free it
    if lsof -Pi ":$BACKEND_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
        if [ "$FORCE_PORTS" -eq 1 ]; then
            log "Force freeing port $BACKEND_PORT after failed start"
            lsof -ti ":$BACKEND_PORT" | xargs -r kill -9 2>/dev/null || true
        else
            log_err "Port $BACKEND_PORT still busy. Retry with --force-ports if appropriate."
        fi
    fi
    exit 1
fi
log "Backend ready."

log "Starting frontend dev server (port $FRONTEND_PORT)..."
(cd "$WEBAPP_DIR" && PORT="$FRONTEND_PORT" npm run dev) &
FRONTEND_PID=$!

log "\n====================================="
log "ROS2 Graph Viewer is running"
log "====================================="
log "Frontend: http://localhost:$FRONTEND_PORT"
log "Backend : http://localhost:$BACKEND_PORT"
log "Press Ctrl+C to stop all servers"
log "====================================="

wait || true
