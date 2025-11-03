import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
} from 'reactflow';
import 'reactflow/dist/style.css';

import ROS2NodeComponent from './components/ROS2Node';
import TopicNodeComponent from './components/TopicNode';
import Toolbar from './components/Toolbar';
import { fetchGraphData } from './api/ros2Api';
import WebSocketClient from './api/websocketClient';
import { layoutGraph } from './utils/layout';
import './App.css';

const nodeTypes = {
  ros2Node: ROS2NodeComponent,
  topicNode: TopicNodeComponent,
};

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true); // Enable polling by default
  const [hideDebugNodes, setHideDebugNodes] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const wsClientRef = useRef(null);
  const useWebSocketRef = useRef(false); // Disabled by default - use polling instead
  const hoveredNodeIdRef = useRef(null);
  const userMovedNodesRef = useRef(new Map()); // Track user-adjusted node positions

  // Keep ref in sync with state
  useEffect(() => {
    hoveredNodeIdRef.current = hoveredNodeId;
  }, [hoveredNodeId]);

  // Custom onNodesChange that tracks user movements
  const handleNodesChange = useCallback((changes) => {
    changes.forEach(change => {
      if (change.type === 'position' && change.dragging === false && change.position) {
        // User finished dragging - save the position
        userMovedNodesRef.current.set(change.id, change.position);
      }
    });
    onNodesChange(changes);
  }, [onNodesChange]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  // Get related edge and node IDs for highlighting
  const getRelatedIds = useCallback((nodeId) => {
    if (!nodeId) return { nodes: [], edges: [] };
    
    const relatedEdges = edges.filter(
      e => e.source === nodeId || e.target === nodeId
    );
    const relatedNodes = new Set([nodeId]);
    relatedEdges.forEach(e => {
      relatedNodes.add(e.source);
      relatedNodes.add(e.target);
    });
    
    return {
      nodes: Array.from(relatedNodes),
      edges: relatedEdges.map(e => e.id)
    };
  }, [edges]);

  const highlightRelated = useCallback((nodeId) => {
    if (!nodeId) {
      setNodes(nds => nds.map(n => ({
        ...n,
        className: ''
      })));
      setEdges(eds => eds.map(e => ({
        ...e,
        animated: false,
        className: ''
      })));
      return;
    }

    const { nodes: relatedNodes, edges: relatedEdges } = getRelatedIds(nodeId);
    
    setNodes(nds => nds.map(n => ({
      ...n,
      className: relatedNodes.includes(n.id) ? 'highlighted' : 'dimmed'
    })));
    
    setEdges(eds => eds.map(e => ({
      ...e,
      animated: relatedEdges.includes(e.id),
      className: relatedEdges.includes(e.id) ? 'highlighted' : 'dimmed'
    })));
  }, [getRelatedIds, setNodes, setEdges]);

  const handleNodeMouseEnter = useCallback((nodeId) => {
    setHoveredNodeId(nodeId);
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  // Handle highlighting when hovered node changes
  useEffect(() => {
    highlightRelated(hoveredNodeId);
  }, [hoveredNodeId, highlightRelated]);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGraphData();
      const { nodes: layoutedNodes, edges: layoutedEdges } = layoutGraph(
        data.nodes,
        data.edges,
        hideDebugNodes
      );
      
      // Preserve user-adjusted positions
      const finalNodes = layoutedNodes.map(n => {
        const userPosition = userMovedNodesRef.current.get(n.id);
        return {
          ...n,
          position: userPosition || n.position, // Use user position if available
          data: {
            ...n.data,
            onMouseEnter: () => handleNodeMouseEnter(n.id),
            onMouseLeave: handleNodeMouseLeave,
          }
        };
      });
      
      setNodes(finalNodes);
      setEdges(layoutedEdges);
    } catch (err) {
      setError(err.message || 'Failed to fetch graph data');
      console.error('Error loading graph:', err);
      // Fallback: disable WebSocket if backend doesn't support it
      useWebSocketRef.current = false;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideDebugNodes]);

  // Initialize WebSocket connection
  useEffect(() => {
    if (!useWebSocketRef.current) return;

    const handleWebSocketUpdate = (graphData) => {
      const { nodes: layoutedNodes, edges: layoutedEdges } = layoutGraph(
        graphData.nodes,
        graphData.edges,
        hideDebugNodes
      );
      
      // Preserve user-adjusted positions
      const finalNodes = layoutedNodes.map(n => {
        const userPosition = userMovedNodesRef.current.get(n.id);
        return {
          ...n,
          position: userPosition || n.position, // Use user position if available
          data: {
            ...n.data,
            onMouseEnter: () => handleNodeMouseEnter(n.id),
            onMouseLeave: handleNodeMouseLeave,
          }
        };
      });
      
      setNodes(finalNodes);
      setEdges(layoutedEdges);
    };

    const handleWebSocketError = (err) => {
      console.log('WebSocket error, falling back to polling:', err);
      useWebSocketRef.current = false;
      setAutoRefresh(true);
    };

    wsClientRef.current = new WebSocketClient(
      '/ws/graph',
      handleWebSocketUpdate,
      handleWebSocketError
    );
    wsClientRef.current.connect();

    return () => {
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideDebugNodes]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    if (!useWebSocketRef.current && autoRefresh) {
      const interval = setInterval(() => {
        loadGraph();
      }, 1000); // Poll every 1 second for near real-time updates
      return () => clearInterval(interval);
    }
  }, [autoRefresh, loadGraph]);

  const handleRefresh = () => {
    loadGraph();
  };

  const handleToggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  const handleToggleDebugNodes = () => {
    setHideDebugNodes(!hideDebugNodes);
    setTimeout(() => loadGraph(), 100);
  };

  const handleToggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  const handleResetLayout = () => {
    // Clear user-adjusted positions and reload
    userMovedNodesRef.current.clear();
    loadGraph();
  };

  return (
    <div className={`app ${darkMode ? 'dark-mode' : ''}`}>
      <Toolbar
        onRefresh={handleRefresh}
        onToggleAutoRefresh={handleToggleAutoRefresh}
        onToggleDebugNodes={handleToggleDebugNodes}
        onToggleDarkMode={handleToggleDarkMode}
        onResetLayout={handleResetLayout}
        autoRefresh={autoRefresh}
        hideDebugNodes={hideDebugNodes}
        darkMode={darkMode}
        loading={loading}
        wsConnected={wsClientRef.current?.isConnected() || false}
      />
      {error && (
        <div className="error-banner">
          Error: {error}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        minZoom={0.1}
        maxZoom={4}
      >
        <Controls />
        <MiniMap />
        <Background variant="dots" gap={12} size={1} />
      </ReactFlow>
    </div>
  );
}

export default App;
