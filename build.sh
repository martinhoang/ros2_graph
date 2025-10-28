#!/bin/bash
# Build script for ROS2 Graph Viewer

set -e

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
echo "To run in production mode:"
echo "  1. Start backend: cd backend && uv run python ros2_graph_server.py"
echo "  2. Serve frontend: cd webapp && npx vite preview"
echo ""
echo "Or use launch.sh for development mode"
echo ""
