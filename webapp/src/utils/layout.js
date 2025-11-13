import dagre from 'dagre';

// Track duplicate warnings to avoid spam
const warnedDuplicates = new Set();

export const layoutGraph = (nodes, edges, hideDebugNodes = true) => {
  // Filter debug nodes if needed
  let filteredNodes = nodes;
  let filteredEdges = edges;

  if (hideDebugNodes) {
    const debugPatterns = [
      /^\/ros_/,                    // ROS2 internal nodes
      /^\/launch_/,                 // Launch system nodes
      /_debug$/,                     // Nodes ending with _debug
      /^\/_/,                        // Nodes starting with /_
      /^\/parameter_events$/,        // Parameter events topic
      /^\/rosout$/,                  // Rosout topic
      /^\/ros2_graph_service$/,      // This package's service node
      /^\/.*\/_/,                    // Topics/nodes with /_ in path
    ];

    const debugNodeIds = new Set();
    filteredNodes = nodes.filter((node) => {
      const label = node.data.label || '';
      const isDebug = debugPatterns.some((pattern) => pattern.test(label));
      if (isDebug) {
        debugNodeIds.add(node.id);
      }
      return !isDebug;
    });

    filteredEdges = edges.filter(
      (edge) => !debugNodeIds.has(edge.source) && !debugNodeIds.has(edge.target)
    );
  }

  // Create a new dagre graph
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR', ranksep: 150, nodesep: 80 });

  // Add nodes to dagre
  filteredNodes.forEach((node) => {
    const width = node.type === 'topicNode' ? 180 : 200;
    const height = node.type === 'topicNode' ? 100 : 120;
    dagreGraph.setNode(node.id, { width, height });
  });

  // Add edges to dagre
  filteredEdges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate layout
  dagre.layout(dagreGraph);

  // Apply layout to nodes
  const layoutedNodes = filteredNodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWithPosition.width / 2,
        y: nodeWithPosition.y - nodeWithPosition.height / 2,
      },
    };
  });

  // Add colors to edges based on connection type and deduplicate
  const seenEdgeIds = new Set();
  const layoutedEdges = filteredEdges
    .filter((edge) => {
      // Deduplicate edges by ID
      if (seenEdgeIds.has(edge.id)) {
        // Only warn once per duplicate edge ID to avoid console spam
        if (!warnedDuplicates.has(edge.id)) {
          console.warn(`Duplicate edge ID detected: ${edge.id}`);
          warnedDuplicates.add(edge.id);
        }
        return false;
      }
      seenEdgeIds.add(edge.id);
      return true;
    })
    .map((edge) => ({
      ...edge,
      animated: true,
      style: {
        strokeWidth: 2,
      },
      type: 'default',
    }));

  return { nodes: layoutedNodes, edges: layoutedEdges };
};

export const createNodeFromROS2Node = (nodeName, index) => {
  return {
    id: `node-${nodeName}`,
    type: 'ros2Node',
    position: { x: 0, y: index * 150 },
    data: {
      label: nodeName,
      namespace: nodeName.split('/').slice(0, -1).join('/') || '/',
    },
  };
};

export const createTopicNode = (topicName, messageType, index, stats = {}) => {
  return {
    id: `topic-${topicName}`,
    type: 'topicNode',
    position: { x: 300, y: index * 150 },
    data: {
      label: topicName,
      messageType: messageType || 'unknown',
      publisherCount: stats.publishers || 0,
      subscriberCount: stats.subscribers || 0,
    },
  };
};

export const createEdge = (sourceId, targetId, edgeType = 'publisher') => {
  return {
    id: `${sourceId}-${targetId}`,
    source: sourceId,
    target: targetId,
    data: { type: edgeType },
  };
};
