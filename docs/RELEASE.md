# Releases & Planned Features

## Planned Features 🚀

### High Priority
- [ ] Leveling of nodes and topics. Usually, when nodes are publishing some topics, those topics should be put below the nodes if the layout is top-bottom. If topics are input into or subscribed by a nodes, the nodes should be below the topics. Nodes that are publishing to topics that are subscribed by other nodes should be put above the topics, and then that topics should be above the nodes. 

### Medium Priority
- [ ] Service and action visualization
- [ ] Connection bandwidth/frequency display

### Low Priority
- [ ] Performance optimization for large graphs (>100 nodes)
- [ ] Custom node styling options
- [ ] Graph history/timeline view
- [ ] Integration tests

## Versions / Releases 📦

### v0.3.0 (Current)
- Search function to highlight nodes/topics by name or substrings in name
- Graph export (PNG, SVG, JSON)
- PointCloud2 and LaserScan 3D rendering
- QoS badges for publishers/subscribers
- Hardware acceleration for PointCloud viewer (Three.js, Regl, DeckGL)

### v0.2.0
- WebSocket support for real-time updates (instead of polling)
- Highlight of node and all its topics (and their connection lines) on hover
- Dark mode theme
- Feature: Drag to select multiple nodes to move them together
- Feature: Auto-fit all the nodes inside the view
- Feature: Display information for ros2 nodes/topics when hovering > 2 secs OR clicking 
- Print the content of the topic messages in the info panel when a topic is selected
- Persistent highlight on click until click elsewhere
- WebSocket subscription cleanup on panel close
- CompressedDepth image rendering with colormap
- ROS2 logging integration (replace print with logger)

### v0.1.0
- React Flow frontend structure
- ROS2 graph visualization components
- Python backend service with Flask
- Graph layout algorithms (Dagre)
- Filtering features (hide debug nodes)
- CMakeLists and package.xml configuration
- Migration to uv for dependency management
