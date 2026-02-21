# Development TODOs

## Completed ✅
- [x] React Flow frontend structure
- [x] ROS2 graph visualization components
- [x] Python backend service with Flask
- [x] Graph layout algorithms (Dagre)
- [x] Filtering features (hide debug nodes)
- [x] CMakeLists and package.xml configuration
- [x] Migration to uv for dependency management
## Planned Features 🚀

### High Priority
- [x] WebSocket support for real-time updates (instead of polling)
- [x] Highlight of node and all its topics (and their connection lines) on hover
- [x] Dark mode theme
- [x] Feature: Drag to select multiple nodes to move them together
- [x] Feature: Auto-fit all the nodes inside the view
- [x] Feature: Display information for ros2 nodes/topics when hovering > 2 secs OR clicking 
- [x] Print the content of the topic messages in the info panel when a topic is selected
- [x] Persistent highlight on click until click elsewhere
- [x] WebSocket subscription cleanup on panel close
- [x] CompressedDepth image rendering with colormap
- [x] ROS2 logging integration (replace print with logger)
- [x] Search function to highlight nodes/topics by name or substrings in name
- [x] Graph export (PNG, SVG, JSON)
- [x] PointCloud2 and LaserScan 3D rendering
- [x] QoS badges for publishers/subscribers
- [x] Hardware acceleration for PointCloud viewer (Three.js, Regl, DeckGL)

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

- **v0.3.0** (Current): Added PointCloud2 and LaserScan 3D rendering with hardware acceleration (Three.js, Regl, DeckGL), QoS badges for publishers/subscribers, search functionality, and layout improvements.
- **v0.2.0**: UI improvements, dark mode, WebSocket support, and CompressedDepth image rendering.
- **v0.1.0**: Initial release with React Flow frontend, Python backend, and basic ROS2 graph visualization.
