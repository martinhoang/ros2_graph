#!/bin/bash
# Build script for ROS2 Graph Viewer

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_RELEASE=false
RELEASE_ARGS=()

usage() {
  cat <<EOF
Usage: $0 [options]

Build ROS2 Graph Viewer for development or create a release bundle.

Options:
  -r, --release              Build a release bundle (calls build_release.sh)
  -i, --install              Build release bundle and install to system
  --arch <x86_64|arm64|auto> Target architecture for release (default: auto)
  --install-dir <path>       Custom installation directory for release
  --backend-port <port>      Default backend port in release bundle (default: 5000)
  --frontend-port <port>     Default frontend port in release bundle (default: 8080)
  -h, --help                 Show help

Examples:
  $0                         # Development build only
  $0 --release               # Development build + release bundle
  $0 --install               # Development build + release bundle + install
  $0 -i --arch arm64         # Build and install for ARM64
EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -r|--release)
      BUILD_RELEASE=true
      shift
      ;;
    -i|--install)
      BUILD_RELEASE=true
      RELEASE_ARGS+=("--install")
      shift
      ;;
    --arch|--install-dir|--backend-port|--frontend-port)
      BUILD_RELEASE=true
      RELEASE_ARGS+=("$1" "$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

echo "Building ROS2 Graph Viewer..."
echo ""

# Sync backend dependencies
echo "Syncing backend dependencies with uv..."
cd backend
uv sync
cd ..

# Build frontend
echo "Building frontend..."
cd webapp
npm install
npm run build
cd ..

echo ""
echo "====================================="
echo "Build completed successfully!"
echo "====================================="
echo ""
echo "Frontend built to: webapp/dist/"
echo ""

if [[ "$BUILD_RELEASE" == "true" ]]; then
  echo ""
  echo "====================================="
  echo "Creating release bundle..."
  echo "====================================="
  echo ""
  
  # Call build_release.sh with accumulated arguments
  "$SCRIPT_DIR/scripts/build_release.sh" "${RELEASE_ARGS[@]}"
  
else
  echo "To run in production mode:"
  echo "  1. Start backend: cd backend && uv run python ros2_graph_server.py"
  echo "  2. Serve frontend: cd webapp && npx vite preview"
  echo ""
  echo "Or use launch.sh for development mode"
  echo ""
  echo "To create a release bundle:"
  echo "  ./build.sh --release      # Create bundle"
  echo "  ./build.sh --install      # Create and install"
  echo ""
fi
