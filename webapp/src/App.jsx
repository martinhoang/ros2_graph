import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
import { fetchGraphData, fetchNodeInfo, fetchTopicInfo, resetGraphState } from './api/ros2Api';
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
  const [showGrid, setShowGrid] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null); // Persists until click elsewhere
  const [selectedNodeInfo, setSelectedNodeInfo] = useState(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [pcRenderer, setPcRenderer] = useState(() => {
    try { return localStorage.getItem('ros2_graph_pc_renderer') || 'threejs'; } catch { return 'threejs'; }
  });
  const { fitView } = useReactFlow();
  const wsClientRef = useRef(null);
  const useWebSocketRef = useRef(false); // Disabled by default - use polling instead
  const hoveredNodeIdRef = useRef(null);
  const selectedNodeIdRef = useRef(null); // Track selected node for persistent highlight
  const userMovedNodesRef = useRef(new Map()); // Track user-adjusted node positions
  const initialLoadRef = useRef(true);
  const isDraggingRef = useRef(false); // Track active drag to pause refreshes
  const pendingGraphRef = useRef(null); // Store latest server data while dragging
  const LAYOUT_STORAGE_KEY = 'ros2_graph_layout_v1';
  const loadingRef = useRef(false); // Prevent rapid flicker by gating loading state
  const loadingDelayRef = useRef(null); // Timeout id for delayed loading activation
  const fetchInProgressRef = useRef(false); // Skip overlapping polls
  const forceResetLayoutRef = useRef(false); // Flag to force layout reset
  const lastGraphDataRef = useRef(null); // Last raw graph payload from backend
  const resetInProgressRef = useRef(false); // Prevent overlapping reset operations
  const resetRecoveryTimerRef = useRef(null); // Background retry timer after reset

  // Persist pointcloud renderer choice
  useEffect(() => {
    try { localStorage.setItem('ros2_graph_pc_renderer', pcRenderer); } catch {}
  }, [pcRenderer]);

  // Toolbar widget definitions (extensible — add more entries for future features)
  const toolbarWidgets = useMemo(() => [
    {
      id: 'pc-renderer',
      type: 'dropdown',
      label: '3D',
      value: pcRenderer,
      onChange: setPcRenderer,
      options: [
        { value: 'threejs', label: 'Three.js', description: 'Full-featured 3D engine' },
        { value: 'regl', label: 'regl', description: 'Lightweight WebGL shaders' },
        { value: 'deckgl', label: 'deck.gl', description: 'Large-scale visualization' },
      ],
    },
  ], [pcRenderer]);

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

  // Keep refs in sync with state
  useEffect(() => {
    hoveredNodeIdRef.current = hoveredNodeId;
  }, [hoveredNodeId]);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

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
  // Use selectedNodeId for persistent highlight, fall back to hoveredNodeId for hover preview
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
    // Highlight connections only — InfoPanel opens on click
    setHoveredNodeId(nodeId);
  }, [isSelecting]);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  const handleNodeClick = useCallback((nodeId) => {
    // Don't show info panel if we're in selection mode
    if (isSelecting) return;
    
    // Set selected node for persistent highlight
    setSelectedNodeId(nodeId);
    
    // Fetch and show details immediately on click
    fetchNodeDetails(nodeId);
  }, [isSelecting]);

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

  const handleCloseInfoPanel = useCallback(() => {
    setSelectedNodeInfo(null);
    setSelectedNodeId(null); // Clear highlight when closing panel
  }, []);

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

    // Use selected node for highlight if available, otherwise use hovered node
    const highlightNodeId = selectedNodeIdRef.current || hoveredNodeIdRef.current;
    const highlighted = decorateHighlight(preparedNodes, layoutedEdges, highlightNodeId);

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

  // Handle highlighting when hovered or selected node changes
  useEffect(() => {
    // Use selected node for persistent highlight, or hovered for preview
    const highlightNodeId = selectedNodeId || hoveredNodeId;
    
    setNodes(prevNodes => {
      const decorated = decorateHighlight(prevNodes, edges, highlightNodeId);
      return decorated.nodes.map(newNode => {
        const existing = prevNodes.find(p => p.id === newNode.id);
        if (!existing) return newNode;
        if (existing.className === newNode.className) return existing;
        return newNode;
      });
    });
    setEdges(prevEdges => {
      const decorated = decorateHighlight(nodes, prevEdges, highlightNodeId);
      return decorated.edges.map(newEdge => {
        const existing = prevEdges.find(e => e.id === newEdge.id);
        if (!existing) return newEdge;
        if (existing.className === newEdge.className && existing.animated === newEdge.animated) return existing;
        return newEdge;
      });
    });
  }, [hoveredNodeId, selectedNodeId, decorateHighlight]);

  const loadGraph = useCallback(async ({ force = false } = {}) => {
    // Avoid overlapping fetches which cause multiple quick state flips
    if (fetchInProgressRef.current && !force) return;
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
      lastGraphDataRef.current = data;
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
      if (!localError && error) setError(null);
      if (localError && localError !== error) setError(localError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyGraphData, error]);

  // Initialize WebSocket connection
  useEffect(() => {
    if (!useWebSocketRef.current) return;

    const handleWebSocketUpdate = (graphData) => {
      lastGraphDataRef.current = graphData;
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
    // Cleanup on unmount
    return () => {
      if (resetRecoveryTimerRef.current) {
        clearTimeout(resetRecoveryTimerRef.current);
        resetRecoveryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!useWebSocketRef.current && autoRefresh) {
      const interval = setInterval(() => {
        loadGraph();
      }, 3000); // Poll every 3 seconds to reduce backend load/noise
      return () => clearInterval(interval);
    }
  }, [autoRefresh, loadGraph]);

  const handleRefresh = () => {
    // Refresh = re-apply default layout from current known graph only (no re-discovery)
    const currentGraph = lastGraphDataRef.current;
    if (!currentGraph) return;

    // Clear user-adjusted positions to restore default layout
    userMovedNodesRef.current.clear();
    savedLayoutRef.current = new Map();
    try { localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch {}

    forceResetLayoutRef.current = true;
    applyGraphData(currentGraph);
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

  const handleToggleGrid = () => {
    setShowGrid(!showGrid);
  };

  const handleResetLayout = async () => {
    // Ignore repeated clicks while reset is already running
    if (resetInProgressRef.current) return;
    resetInProgressRef.current = true;

    try {
      if (resetRecoveryTimerRef.current) {
        clearTimeout(resetRecoveryTimerRef.current);
        resetRecoveryTimerRef.current = null;
      }

      // Show resetting status
      setLoading(true);
      setError(null);

      // Reset = clear graph/cache, force backend runtime reset, then re-discover
      setSelectedNodeInfo(null);
      setHoveredNodeId(null);
      setNodes([]);
      setEdges([]);

      // Clear user-adjusted positions and saved layout
      userMovedNodesRef.current.clear();
      savedLayoutRef.current = new Map();
      try { localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch {}

      // Clear local cached graph data
      lastGraphDataRef.current = null;
      pendingGraphRef.current = null;

      // Set flag to force re-layout on next graph update
      forceResetLayoutRef.current = true;

      // Call backend reset
      try {
        await resetGraphState();
      } catch (err) {
        console.warn('Backend reset failed, continuing:', err);
      }

      // Aggressive recovery with recursive retry pattern
      const attemptRecovery = async (attemptsLeft) => {
        if (attemptsLeft <= 0) {
          setLoading(false);
          setError('Graph discovery timeout. Nodes may still be starting. Click Refresh to retry.');
          return;
        }

        try {
          const data = await fetchGraphData();
          lastGraphDataRef.current = data;
          const hasContent = data && (
            (Array.isArray(data.nodes) && data.nodes.length > 0) ||
            (Array.isArray(data.edges) && data.edges.length > 0)
          );

          if (hasContent) {
            applyGraphData(data);
            setLoading(false);
            setError(null);
            console.log('Reset complete: graph recovered');
          } else {
            // No content yet, retry after delay
            resetRecoveryTimerRef.current = setTimeout(() => {
              attemptRecovery(attemptsLeft - 1);
            }, 600);
          }
        } catch (err) {
          console.error('Recovery attempt failed:', err);
          // Retry on error
          resetRecoveryTimerRef.current = setTimeout(() => {
            attemptRecovery(attemptsLeft - 1);
          }, 800);
        }
      };

      // Start recovery with up to 40 attempts (~30+ seconds)
      await attemptRecovery(40);

    } finally {
      resetInProgressRef.current = false;
    }
  };

  const handleFitView = useCallback(() => {
    try {
      fitView({ padding: 0.2, duration: 400, includeHiddenNodes: false });
    } catch (error) {
      console.warn('Fit view failed:', error);
    }
  }, [fitView]);

  const handleSelectionStart = useCallback(() => {
    setIsSelecting(true);
  }, []);

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
        onToggleGrid={handleToggleGrid}
        onResetLayout={handleResetLayout}
        onFitView={handleFitView}
        autoRefresh={autoRefresh}
        hideDebugNodes={hideDebugNodes}
        darkMode={darkMode}
        showGrid={showGrid}
        loading={loading}
        wsConnected={wsClientRef.current?.isConnected() || false}
        widgets={toolbarWidgets}
      />
      {error && (
        <div className="error-banner">
          Error: {error}
        </div>
      )}
      <InfoPanel 
        nodeInfo={selectedNodeInfo}
        onClose={handleCloseInfoPanel}
        pcRenderer={pcRenderer}
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
            onPaneClick={() => setSelectedNodeId(null)}
          >
            <Controls />
            <MiniMap />
            {showGrid ? <Background variant="dots" gap={12} size={1} /> : null}
          </ReactFlow>
        </div>
    </div>
  );
}

export default App;
