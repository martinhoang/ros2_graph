import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';

import ROS2NodeComponent from './components/ROS2Node';
import TopicNodeComponent from './components/TopicNode';
import Toolbar from './components/Toolbar';
import InfoPanel from './components/InfoPanel';
import { fetchGraphData, fetchNodeInfo, fetchTopicInfo } from './api/ros2Api';
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
  const [hideDebugNodes, setHideDebugNodes] = useState(true); // Hide debug nodes by default
  const [darkMode, setDarkMode] = useState(true); // Dark mode enabled by default
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedNodeInfo, setSelectedNodeInfo] = useState(null);
  const [hoverTimer, setHoverTimer] = useState(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const { fitView } = useReactFlow();
  const wsClientRef = useRef(null);
  const useWebSocketRef = useRef(false); // Disabled by default - use polling instead
  const hoveredNodeIdRef = useRef(null);
  const userMovedNodesRef = useRef(new Map()); // Track user-adjusted node positions
  const initialLoadRef = useRef(true);
  const isDraggingRef = useRef(false); // Track active drag to pause refreshes
  const pendingGraphRef = useRef(null); // Store latest server data while dragging
  const LAYOUT_STORAGE_KEY = 'ros2_graph_layout_v1';
  const loadingRef = useRef(false); // Prevent rapid flicker by gating loading state
  const loadingDelayRef = useRef(null); // Timeout id for delayed loading activation
  const fetchInProgressRef = useRef(false); // Skip overlapping polls
  const forceResetLayoutRef = useRef(false); // Flag to force layout reset

  // Load saved layout from localStorage
  const loadSavedLayout = useCallback(() => {
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!raw) return new Map();
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    } catch {
      return new Map();
    }
  }, []);

  const savedLayoutRef = useRef(loadSavedLayout());

  // Persist layout (userMovedNodesRef merged with savedLayoutRef)
  const persistLayout = useCallback(() => {
    const merged = new Map(savedLayoutRef.current);
    userMovedNodesRef.current.forEach((pos, id) => {
      merged.set(id, pos);
    });
    savedLayoutRef.current = merged;
    try {
      const obj = Object.fromEntries(merged.entries());
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      console.warn('Failed to persist layout', e);
    }
  }, []);

  // Keep ref in sync with state
  useEffect(() => {
    hoveredNodeIdRef.current = hoveredNodeId;
  }, [hoveredNodeId]);

  // Custom onNodesChange that tracks user movements
  const handleNodesChange = useCallback((changes) => {
    let anyDragging = false;
    let anyDragStop = false;
    changes.forEach(change => {
      if (change.type === 'position') {
        if (change.dragging) {
          anyDragging = true;
        } else if (change.dragging === false && change.position) {
          anyDragStop = true;
          userMovedNodesRef.current.set(change.id, change.position);
        }
      }
    });
    if (anyDragging) {
      isDraggingRef.current = true; // pause incoming updates
    }
    if (anyDragStop && !anyDragging) {
      // Drag gesture finished
      isDraggingRef.current = false;
      persistLayout();
      // If we queued a server update while dragging, apply it now
      if (pendingGraphRef.current) {
        applyGraphData(pendingGraphRef.current, { fromPending: true });
        pendingGraphRef.current = null;
      }
    }
    onNodesChange(changes);
  }, [onNodesChange, persistLayout]);

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

  // Pure highlight decoration without triggering two-stage state updates
  const decorateHighlight = useCallback((rawNodes, rawEdges, nodeId) => {
    if (!nodeId) {
      return {
        nodes: rawNodes.map(n => ({ ...n, className: '' })),
        edges: rawEdges.map(e => ({ ...e, animated: false, className: '' }))
      };
    }
    const { nodes: relatedNodes, edges: relatedEdges } = getRelatedIds(nodeId);
    return {
      nodes: rawNodes.map(n => ({
        ...n,
        className: relatedNodes.includes(n.id) ? 'highlighted' : 'dimmed'
      })),
      edges: rawEdges.map(e => ({
        ...e,
        animated: relatedEdges.includes(e.id),
        className: relatedEdges.includes(e.id) ? 'highlighted' : 'dimmed'
      }))
    };
  }, [getRelatedIds]);

  // Hover handlers must be defined before applyGraphData uses them
  const handleNodeMouseEnter = useCallback((nodeId) => {
    // Don't show hover effects during selection
    if (isSelecting) return;
    
    setHoveredNodeId(nodeId);
    
    // Clear any existing timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }
    
    // Set a 2-second timer to show info panel
    const timer = setTimeout(() => {
      // Double-check we're not selecting when timer fires
      if (!isSelecting) {
        fetchNodeDetails(nodeId);
      }
    }, 2000);
    
    setHoverTimer(timer);
  }, [hoverTimer, isSelecting]);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
    
    // Clear the timer when mouse leaves
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      setHoverTimer(null);
    }
  }, [hoverTimer]);

  const handleNodeClick = useCallback((nodeId) => {
    // Don't show info panel if we're in selection mode
    if (isSelecting) return;
    
    // Clear any hover timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      setHoverTimer(null);
    }
    
    // Fetch and show details immediately on click
    fetchNodeDetails(nodeId);
  }, [hoverTimer, isSelecting]);

  const fetchNodeDetails = async (nodeId) => {
    // Extract the type and name from the node ID
    const isNode = nodeId.startsWith('node-');
    const isTopic = nodeId.startsWith('topic-');
    
    if (!isNode && !isTopic) return;
    
    // Extract the name from the ID
    const name = nodeId.replace(/^(node|topic)-/, '');
    
    // Set loading state
    setSelectedNodeInfo({
      type: isNode ? 'ros2Node' : 'topicNode',
      name: name,
      loading: true,
    });
    
    try {
      let details;
      if (isNode) {
        details = await fetchNodeInfo(name);
        setSelectedNodeInfo({
          type: 'ros2Node',
          name: details.name,
          namespace: details.namespace,
          publishers: details.publishers,
          subscribers: details.subscribers,
          loading: false,
        });
      } else {
        details = await fetchTopicInfo(name);
        setSelectedNodeInfo({
          type: 'topicNode',
          name: details.name,
          types: details.types,
          publishers: details.publishers,
          subscribers: details.subscribers,
          loading: false,
        });
      }
    } catch (error) {
      setSelectedNodeInfo({
        type: isNode ? 'ros2Node' : 'topicNode',
        name: name,
        error: error.message || 'Failed to fetch details',
        loading: false,
      });
    }
  };

  const handleCloseInfoPanel = () => {
    setSelectedNodeInfo(null);
    
    // Clear any hover timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      setHoverTimer(null);
    }
  };

  // Shared function to process server graph data into state while respecting saved layout and drag pause
  const applyGraphData = useCallback((graphData, { fromPending = false } = {}) => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = layoutGraph(
      graphData.nodes,
      graphData.edges,
      hideDebugNodes
    );

    const preparedNodes = layoutedNodes.map(n => {
      const userPosition = userMovedNodesRef.current.get(n.id) || savedLayoutRef.current.get(n.id);
      return {
        ...n,
        position: userPosition || n.position,
        data: {
          ...n.data,
            onMouseEnter: () => handleNodeMouseEnter(n.id),
            onMouseLeave: handleNodeMouseLeave,
            onClick: () => handleNodeClick(n.id),
        }
      };
    });

    const highlighted = decorateHighlight(preparedNodes, layoutedEdges, hoveredNodeIdRef.current);

    setNodes(prev => {
      // If forcing reset, bypass comparison and use all new positions
      if (forceResetLayoutRef.current) {
        return highlighted.nodes;
      }
      
      const prevMap = new Map(prev.map(n => [n.id, n]));
      return highlighted.nodes.map(n => {
        const existing = prevMap.get(n.id);
        if (!existing) return n;
        const unchanged = (
          existing.position.x === n.position.x &&
          existing.position.y === n.position.y &&
          existing.type === n.type &&
          existing.className === n.className &&
          JSON.stringify(existing.data) === JSON.stringify(n.data)
        );
        return unchanged ? existing : n;
      });
    });

    setEdges(prev => {
      const prevMap = new Map(prev.map(e => [e.id, e]));
      const nextEdges = highlighted.edges.map(e => {
        const existing = prevMap.get(e.id);
        if (!existing) return e;
        const unchanged = (
          existing.source === e.source &&
          existing.target === e.target &&
          existing.type === e.type &&
          existing.animated === e.animated &&
          existing.className === e.className
        );
        return unchanged ? existing : e;
      });
      if (nextEdges.length === prev.length && nextEdges.every((e, i) => e === prev[i])) {
        return prev;
      }
      return nextEdges;
    });

    if (initialLoadRef.current && !fromPending) {
      initialLoadRef.current = false;
    }
    
    // Clear force reset flag after applying
    if (forceResetLayoutRef.current) {
      forceResetLayoutRef.current = false;
    }
  }, [decorateHighlight, hideDebugNodes, hoveredNodeIdRef]);

  // Handle highlighting when hovered node changes without clearing graph first
  useEffect(() => {
    // Only recompute when hoveredNodeId changes to avoid feedback loops
    setNodes(prevNodes => {
      const decorated = decorateHighlight(prevNodes, edges, hoveredNodeId);
      return decorated.nodes.map(newNode => {
        const existing = prevNodes.find(p => p.id === newNode.id);
        if (!existing) return newNode;
        if (existing.className === newNode.className) return existing;
        return newNode;
      });
    });
    setEdges(prevEdges => {
      const decorated = decorateHighlight(nodes, prevEdges, hoveredNodeId);
      return decorated.edges.map(newEdge => {
        const existing = prevEdges.find(e => e.id === newEdge.id);
        if (!existing) return newEdge;
        if (existing.className === newEdge.className && existing.animated === newEdge.animated) return existing;
        return newEdge;
      });
    });
  }, [hoveredNodeId, decorateHighlight]);

  const loadGraph = useCallback(async () => {
    // Avoid overlapping fetches which cause multiple quick state flips
    if (fetchInProgressRef.current) return;
    fetchInProgressRef.current = true;

    // Only expose visual loading if operation exceeds threshold (reduce flicker)
    if (!loadingRef.current) {
      loadingRef.current = true;
      loadingDelayRef.current = setTimeout(() => {
        // Only set if still loading
        if (loadingRef.current) setLoading(true);
      }, 200); // 200ms threshold
    }

    // Preserve previous error unless new one occurs
    let localError = null;
    try {
      const data = await fetchGraphData();
      if (isDraggingRef.current) {
        pendingGraphRef.current = data; // queue while dragging
      } else {
        applyGraphData(data);
      }
    } catch (err) {
      localError = err.message || 'Failed to fetch graph data';
      console.error('Error loading graph:', err);
      useWebSocketRef.current = false;
    } finally {
      // Clear delayed loading timer and state
      if (loadingDelayRef.current) {
        clearTimeout(loadingDelayRef.current);
        loadingDelayRef.current = null;
      }
      loadingRef.current = false;
      setLoading(false); // Single transition instead of rapid toggle
      fetchInProgressRef.current = false;
      if (localError && localError !== error) setError(localError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyGraphData, error]);

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
            onClick: () => handleNodeClick(n.id),
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
    // Cleanup hover timer on unmount
    return () => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
      }
    };
  }, [hoverTimer]);

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
    // Clear user-adjusted positions and saved layout
    userMovedNodesRef.current.clear();
    savedLayoutRef.current = new Map();
    try { localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch {}
    
    // Set flag to force re-layout on next graph update
    forceResetLayoutRef.current = true;
    
    // Force re-layout by reloading the graph
    loadGraph();
  };

  const handleFitView = () => {
    fitView({ padding: 0.2, duration: 400 });
  };

  const handleSelectionStart = useCallback(() => {
    setIsSelecting(true);
    // Clear any pending hover timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      setHoverTimer(null);
    }
  }, [hoverTimer]);

  const handleSelectionEnd = useCallback(() => {
    setIsSelecting(false);
  }, []);

  return (
    <div className={`app ${darkMode ? 'dark-mode' : ''}`}>
      <Toolbar
        onRefresh={handleRefresh}
        onToggleAutoRefresh={handleToggleAutoRefresh}
        onToggleDebugNodes={handleToggleDebugNodes}
        onToggleDarkMode={handleToggleDarkMode}
        onResetLayout={handleResetLayout}
        onFitView={handleFitView}
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
      <InfoPanel 
        nodeInfo={selectedNodeInfo}
        onClose={handleCloseInfoPanel}
      />
        <div className="reactflow-wrapper">
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
            selectionOnDrag
            selectionMode="partial"
            multiSelectionKeyCode={null}
            panOnDrag={[1, 2]}
            selectionKeyCode={null}
            onSelectionStart={handleSelectionStart}
            onSelectionEnd={handleSelectionEnd}
          >
            <Controls />
            <MiniMap />
            <Background variant="dots" gap={12} size={1} />
          </ReactFlow>
        </div>
    </div>
  );
}

export default App;
