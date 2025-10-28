#!/bin/bash
# Launch script for ROS2 Graph Viewer

set -e

echo "Starting ROS2 Graph Viewer..."
echo ""

# Check if ROS2 is sourced
if [ -z "$ROS_DISTRO" ]; then
    echo "Error: ROS2 is not sourced!"
    echo "Please source your ROS2 installation first:"
    echo "  source /opt/ros/<distro>/setup.bash"
    echo "  source ~/umanoid_ws/install/setup.bash  # if you built this package"
    exit 1
fi

echo "Using ROS2 distro: $ROS_DISTRO"

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "Error: uv is not installed. Please install it first:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

# Function to cleanup processes
cleanup() {
    echo ""
    echo "Stopping servers..."
    
    # Kill backend process
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    
    # Kill frontend process
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    
    # Force kill any remaining ros2_graph_server processes
    pkill -f ros2_graph_server.py 2>/dev/null || true
    
    # Kill any process on port 5000
    lsof -ti :5000 | xargs kill -9 2>/dev/null || true
    
    # Kill any process on port 3000
    lsof -ti :3000 | xargs kill -9 2>/dev/null || true
    
    echo "Cleanup complete"
    exit 0
}

# Trap Ctrl+C and other termination signals
trap cleanup SIGINT SIGTERM EXIT

# Check if ports are already in use
if lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Warning: Port 5000 is already in use. Cleaning up..."
    lsof -ti :5000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Warning: Port 3000 is already in use. Cleaning up..."
    lsof -ti :3000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# Sync backend dependencies
echo "Syncing backend dependencies with uv..."
cd backend
uv sync
cd ..

# Check if frontend dependencies are installed
if [ ! -d "webapp/node_modules" ]; then
    echo "Installing frontend dependencies..."
    cd webapp
    npm install
    cd ..
fi

# Start backend server with system site packages for ROS2
echo "Starting backend server..."
cd backend
uv run python ros2_graph_server.py &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Check if backend started successfully
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "Error: Backend failed to start"
    exit 1
fi

# Start frontend dev server
echo "Starting frontend dev server..."
cd webapp
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "====================================="
echo "ROS2 Graph Viewer is running!"
echo "====================================="
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:5000"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Wait for processes
wait
