#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
WEBAPP_DIR="$ROOT_DIR/webapp"
RELEASE_DIR="$ROOT_DIR/.build/release"
BACKEND_PORT=5000
FRONTEND_PORT=8080
TARGET_ARCH="auto"
INSTALL_BUNDLE=false
INSTALL_DIR="$HOME/.local/share/ros2-graph"
usage() {
  cat <<EOF
Usage: $0 [options]

Build a native (non-Docker) Ubuntu release bundle for ROS2 Graph Viewer.

Options:
  --arch <x86_64|arm64|auto>  Target architecture (default: auto)
  --backend-port <port>        Default backend port in bundled launcher (default: 5000)
  --frontend-port <port>       Default frontend port in bundled launcher (default: 8080)
  -i, --install                Install the built bundle to system (default: ~/.local/share/ros2-graph)
  --install-dir <path>         Custom installation directory (implies --install)
  -h, --help                   Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) TARGET_ARCH="$2"; shift 2 ;;
    --backend-port) BACKEND_PORT="$2"; shift 2 ;;
    --frontend-port) FRONTEND_PORT="$2"; shift 2 ;;
    -i|--install) INSTALL_BUNDLE=true; shift ;;
    --install-dir) INSTALL_DIR="$2"; INSTALL_BUNDLE=true; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

normalize_arch() {
  case "$1" in
    x86_64|amd64) echo "x86_64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) echo "$1" ;;
  esac
}

HOST_ARCH="$(normalize_arch "$(uname -m)")"
if [[ "$TARGET_ARCH" == "auto" ]]; then
  TARGET_ARCH="$HOST_ARCH"
else
  TARGET_ARCH="$(normalize_arch "$TARGET_ARCH")"
fi

if [[ "$TARGET_ARCH" != "x86_64" && "$TARGET_ARCH" != "arm64" ]]; then
  echo "Unsupported arch '$TARGET_ARCH'. Use x86_64 or arm64." >&2
  exit 1
fi

if [[ "$TARGET_ARCH" != "$HOST_ARCH" ]]; then
  echo "Note: Building $TARGET_ARCH bundle on $HOST_ARCH host (cross-arch build)"
  echo "This works because the bundle contains only source code and static assets."
  echo ""
fi

if [[ -z "${ROS_DISTRO:-}" ]]; then
  echo "ROS_DISTRO is not set. Source your ROS2 environment first." >&2
  exit 1
fi

command -v uv >/dev/null 2>&1 || { echo "Missing 'uv'" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Missing 'npm'" >&2; exit 1; }

VERSION="$(grep -m1 '"version"' "$WEBAPP_DIR/package.json" | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/')"
if [[ -z "$VERSION" ]]; then
  VERSION="0.0.0"
fi

BUNDLE_NAME="ros2-graph-${VERSION}-ubuntu-${TARGET_ARCH}"
BUNDLE_DIR="$RELEASE_DIR/$BUNDLE_NAME"
BACKEND_BUNDLE_DIR="$BUNDLE_DIR/backend"
FRONTEND_DIR="$BUNDLE_DIR/webapp"

rm -rf "$BUNDLE_DIR"
mkdir -p "$BACKEND_BUNDLE_DIR" "$FRONTEND_DIR"

echo "[1/4] Prepare backend source and dependencies"
cp "$BACKEND_DIR/ros2_graph_server.py" "$BACKEND_BUNDLE_DIR/"
cp "$BACKEND_DIR/server_logging.py" "$BACKEND_BUNDLE_DIR/"
cp "$BACKEND_DIR/pyproject.toml" "$BACKEND_BUNDLE_DIR/"

# Create a portable uv.lock if available
if [[ -f "$BACKEND_DIR/uv.lock" ]]; then
  cp "$BACKEND_DIR/uv.lock" "$BACKEND_BUNDLE_DIR/"
fi

echo "[2/4] Build frontend assets"
(cd "$WEBAPP_DIR" && npm install && npm run build)
cp -r "$WEBAPP_DIR/dist" "$FRONTEND_DIR/dist"

echo "[3/4] Create requirements.txt for pip fallback"
cat > "$BACKEND_BUNDLE_DIR/requirements.txt" <<EOF_REQS
# Flask dependencies only - ROS2 packages come from system installation
# DO NOT add rclpy or other ROS2 packages here
flask>=2.3.0
flask-cors>=4.0.0
flask-sock>=0.7.0
numpy>=1.24.4
pyyaml>=6.0.3
EOF_REQS

echo "[4/4] Create launcher scripts"
cat > "$BUNDLE_DIR/run.sh" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
WEBAPP_DIR="$SCRIPT_DIR/webapp"
BACKEND_PORT="${BACKEND_PORT:-5000}"

if [[ -z "${ROS_DISTRO:-}" ]]; then
  echo "ERROR: ROS_DISTRO is not set. Source ROS2 first:" >&2
  echo "  source /opt/ros/<distro>/setup.bash" >&2
  exit 1
fi

echo "ROS2 Graph Viewer"
echo "================="
echo "ROS Distro: $ROS_DISTRO"
echo ""

# Check for Python and dependencies
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found" >&2
  exit 1
fi

# Install backend dependencies on first run if needed
VENV_DIR="$BACKEND_DIR/.venv"
if [[ ! -d "$VENV_DIR" ]]; then
  echo "Setting up Python environment (first-time only)..."
  echo "Creating venv with system-site-packages (for ROS2 access)..."
  python3 -m venv --system-site-packages "$VENV_DIR"
  source "$VENV_DIR/bin/activate"
  pip install --quiet --upgrade pip
  echo "Installing Flask dependencies (ROS2 uses system packages)..."
  pip install -r "$BACKEND_DIR/requirements.txt"
  echo "Setup complete."
  echo ""
else
  source "$VENV_DIR/bin/activate"
fi

# Verify ROS2 Python bindings are accessible
echo "Verifying ROS2 Python bindings..."
if ! python3 -c "import rclpy" 2>/dev/null; then
  echo "ERROR: Cannot import rclpy. ROS2 Python bindings not found." >&2
  echo "Make sure you've sourced your ROS2 environment before running this script." >&2
  echo "Example: source /opt/ros/humble/setup.bash" >&2
  exit 1
fi
echo "ROS2 bindings OK"
echo ""

cleanup() {
  local code=$?
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  exit $code
}
trap cleanup SIGINT SIGTERM EXIT

echo "Starting ROS2 Graph Viewer server..."
cd "$BACKEND_DIR"
python3 ros2_graph_server.py --port "$BACKEND_PORT" --static-dir "$WEBAPP_DIR/dist" &
BACKEND_PID=$!

# Wait for backend to be ready
for i in {1..20}; do
  if curl -fsS "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo ""
echo "======================================"
echo "ROS2 Graph Viewer is running"
echo "======================================"
echo "Server: http://localhost:$BACKEND_PORT"
echo ""
echo "Open http://localhost:$BACKEND_PORT in your browser"
echo "Press Ctrl+C to stop"
echo "======================================"

wait
EOF
chmod +x "$BUNDLE_DIR/run.sh"

cat > "$BUNDLE_DIR/README.txt" <<EOF_README
ROS2 Graph Viewer Release Bundle
================================
Architecture: $TARGET_ARCH
Version: $VERSION

IMPORTANT:
  This bundle does NOT include ROS2. It uses your system's ROS2 installation.
  ROS2 must be installed and sourced before running this application.

Requirements:
  - ROS2 installed on system (any distro: Humble, Iron, Jazzy, etc.)
  - Python 3.8+ with venv support
  - curl (for health checks)

What's included:
  - Frontend web application (static files)
  - Backend Python source code
  - Flask and supporting Python libraries

What's NOT included (uses system packages):
  - ROS2 runtime and libraries (rclpy, etc.)
  - Python ROS2 bindings

Usage:
  1) Source your ROS2 environment:
       source /opt/ros/<distro>/setup.bash
  
  2) Run the application:
       ./run.sh
  
  3) Open http://localhost:8080 in your browser

On first run, the script will create a Python virtual environment (with 
--system-site-packages to access ROS2) and install Flask dependencies. 
This takes ~30 seconds. Subsequent runs start immediately.

Optional environment variables:
  BACKEND_PORT=<port>   Backend API port (default: 5000)
  FRONTEND_PORT=<port>  Web UI port (default: 8080)

Example:
  BACKEND_PORT=9000 FRONTEND_PORT=3000 ./run.sh

Troubleshooting:
  - Ensure ROS2 environment is sourced before running
  - Check that ports 5000 and 8080 are available
  - For ARM64 (Jetson), ensure python3-venv is installed:
      sudo apt install python3-venv
  - Verify rclpy is accessible: python3 -c "import rclpy; print('OK')"
EOF_README

(cd "$RELEASE_DIR" && tar -czf "${BUNDLE_NAME}.tar.gz" "$BUNDLE_NAME")

echo "Release ready: $RELEASE_DIR/${BUNDLE_NAME}.tar.gz"

if [[ "$INSTALL_BUNDLE" == "true" ]]; then
  echo ""
  echo "[Installing to $INSTALL_DIR]"
  
  # Create installation directory
  mkdir -p "$INSTALL_DIR"
  
  # Remove old installation if exists
  if [[ -d "$INSTALL_DIR/ros2-graph" ]]; then
    echo "Removing previous installation..."
    rm -rf "$INSTALL_DIR/ros2-graph"
  fi
  
  # Copy bundle to installation directory
  echo "Copying application files..."
  cp -r "$BUNDLE_DIR" "$INSTALL_DIR/ros2-graph"
  
  # Create launcher script
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
  
  cat > "$BIN_DIR/ros2-graph" <<'EOF_LAUNCHER'
#!/usr/bin/env bash
INSTALL_DIR="__INSTALL_DIR__"
exec "$INSTALL_DIR/ros2-graph/run.sh" "$@"
EOF_LAUNCHER
  
  # Replace placeholder with actual install dir
  sed -i "s|__INSTALL_DIR__|$INSTALL_DIR|g" "$BIN_DIR/ros2-graph"
  chmod +x "$BIN_DIR/ros2-graph"
  
  # Create alternative launcher with underscore naming
  ln -sf "$BIN_DIR/ros2-graph" "$BIN_DIR/ros2_graph"
  
  # Create desktop entry (optional, for GUI environments)
  DESKTOP_DIR="$HOME/.local/share/applications"
  if [[ -d "$DESKTOP_DIR" ]] || mkdir -p "$DESKTOP_DIR" 2>/dev/null; then
    cat > "$DESKTOP_DIR/ros2-graph.desktop" <<EOF_DESKTOP
[Desktop Entry]
Name=ROS2 Graph Viewer
Comment=Visualize ROS2 computation graph
Exec=$BIN_DIR/ros2-graph
Icon=network-wired
Terminal=true
Type=Application
Categories=Development;ROS;
EOF_DESKTOP
    chmod +x "$DESKTOP_DIR/ros2-graph.desktop"
  fi
  
  echo ""
  echo "====================================="
  echo "Installation complete!"
  echo "====================================="
  echo "Installed to: $INSTALL_DIR/ros2-graph"
  echo "Launchers: $BIN_DIR/ros2-graph (or ros2_graph)"
  echo ""
  echo "Usage:"
  echo "  1. Source your ROS2 environment:"
  echo "       source /opt/ros/<distro>/setup.bash"
  echo ""
  echo "  2. Run the application:"
  echo "       ros2-graph   (or ros2_graph)"
  echo ""
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "NOTE: Add $BIN_DIR to your PATH:"
    echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc"
    echo "  source ~/.bashrc"
    echo ""
  fi
  echo "====================================="
fi
