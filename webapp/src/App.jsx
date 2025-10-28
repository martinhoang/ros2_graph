import React, { useState, useCallback, useEffect } from 'react';
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
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [hideDebugNodes, setHideDebugNodes] = useState(true);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

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
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    } catch (err) {
      setError(err.message || 'Failed to fetch graph data');
      console.error('Error loading graph:', err);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges, hideDebugNodes]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        loadGraph();
      }, 2000);
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
    // Reload graph with new filter
    setTimeout(() => loadGraph(), 100);
  };

  return (
    <div className="app">
      <Toolbar
        onRefresh={handleRefresh}
        onToggleAutoRefresh={handleToggleAutoRefresh}
        onToggleDebugNodes={handleToggleDebugNodes}
        autoRefresh={autoRefresh}
        hideDebugNodes={hideDebugNodes}
        loading={loading}
      />
      {error && (
        <div className="error-banner">
          Error: {error}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
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
