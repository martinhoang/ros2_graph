# ROS2 Graph Viewer

Modern web-based visualization for ROS2 node and topic graphs. Like rqt_graph but with React Flow.

![ROS2 Graph Viewer](Screenshot_20251028_064601.png)

## Prerequisites

- ROS2 (Humble, Iron, or later)
- Python 3.8+
- [uv](https://docs.astral.sh/uv/) - `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Node.js 16+ and npm

## Quick Start

```bash
# Source ROS2 first!
source /opt/ros/<your-distro>/setup.bash

cd ~/umanoid_ws/src/ros2_graph

# Install dependencies
cd backend && uv sync && cd ..
cd webapp && npm install && cd ..

# Launch (starts both backend and frontend)
./launch.sh
```

Open browser to: `http://localhost:3000`

## Manual Start

```bash
# Source ROS2 first!
source /opt/ros/<your-distro>/setup.bash

# Terminal 1 - Backend
cd backend && uv run python ros2_graph_server.py

# Terminal 2 - Frontend
cd webapp && npm run dev
```

## Features

- 🎨 Interactive graph with drag, zoom, pan
- 🔄 Real-time updates via WebSocket (auto-fallback to polling)
- 🎯 Filter debug/internal nodes
- ✨ Hover highlighting - see node connections instantly
- 🌙 Dark mode theme toggle
- 📦 Purple nodes = ROS2 nodes
- 📡 White rounded boxes = Topics (color-coded by message type)
- ⚡ Blazingly fast with uv (10-100x faster than pip)

## API Endpoints

- `GET /api/graph` - Complete graph data
- `GET /api/node/<name>` - Node details
- `GET /api/topic/<name>` - Topic details
- `GET /api/health` - Health check
- `WebSocket /ws/graph` - Real-time graph updates

## Project Structure

```
ros2_graph/
├── backend/
│   ├── ros2_graph_server.py  # Flask + rclpy server
│   ├── pyproject.toml        # uv dependencies
│   └── .venv/                # Virtual env (auto-created)
├── webapp/
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── api/             # API client
│   │   └── utils/           # Layout algorithms
│   └── package.json         # npm dependencies
├── launch.sh                # Quick launcher
└── README.md               # This file
```

## Troubleshooting

**Backend issues:**
- Source ROS2 first: `source /opt/ros/<distro>/setup.bash`
- Check dependencies: `cd backend && uv sync`

**Port in use:** Kill processes: `lsof -i :5000` or `lsof -i :3000`  
**No nodes showing:** Make sure ROS2 nodes are running, then refresh  

## uv Quick Reference

```bash
cd backend
uv sync              # Install dependencies
uv add package       # Add new dependency
uv run python file.py  # Run with venv
```

## Build for Production

```bash
./build.sh
# Then serve: cd backend && uv run python ros2_graph_server.py
```

## Tech Stack

Frontend: React 18, React Flow, Vite  
Backend: Flask, rclpy  
Layout: Dagre

## License

Apache-2.0

---

For TODOs and planned features, see [docs/TODO.md](docs/TODO.md)
