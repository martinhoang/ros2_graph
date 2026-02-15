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

  // Dependency-level layout:
  // Uses edge direction to assign rows (levels), so chains like
  // node -> topic -> node become top -> middle -> bottom.
  const nodeById = new Map(filteredNodes.map((node) => [node.id, node]));
  const incomingCount = new Map(filteredNodes.map((node) => [node.id, 0]));
  const adjacency = new Map(filteredNodes.map((node) => [node.id, []]));
  const levelMap = new Map(filteredNodes.map((node) => [node.id, 0]));

  filteredEdges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
    adjacency.get(edge.source).push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1);
  });

  const queue = [];
  incomingCount.forEach((count, nodeId) => {
    if (count === 0) queue.push(nodeId);
  });

  // If graph has cycles, seed queue with all nodes to keep layout deterministic.
  if (queue.length === 0 && filteredNodes.length > 0) {
    queue.push(...filteredNodes.map((node) => node.id));
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const currentLevel = levelMap.get(current) || 0;
    const neighbors = adjacency.get(current) || [];

    neighbors.forEach((targetId) => {
      const nextLevel = currentLevel + 1;
      if ((levelMap.get(targetId) || 0) < nextLevel) {
        levelMap.set(targetId, nextLevel);
      }

      const nextIncoming = (incomingCount.get(targetId) || 0) - 1;
      incomingCount.set(targetId, nextIncoming);
      if (nextIncoming === 0) {
        queue.push(targetId);
      }
    });
  }

  const levels = new Map();
  filteredNodes.forEach((node) => {
    const level = levelMap.get(node.id) || 0;
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(node);
  });

  const sortedLevels = Array.from(levels.keys()).sort((a, b) => a - b);
  const horizontalGap = 40;
  const verticalGap = 140;
  const maxNodesPerRow = 8; // Limit horizontal nodes to prevent long rows

  // Use fixed layout widths that match the CSS max-width + padding.
  // ROS2 nodes: CSS max-width 300px + padding 30px = 330px rendered
  // Topic nodes: CSS max-width 300px + padding 30px = 330px rendered
  // For shorter labels, use a smaller width so the layout isn't too sparse.
  const getNodeLayoutWidth = (node) => {
    const label = node.data?.label || node.id;
    const isRos2Node = node.type === 'ros2Node';
    // CSS max-width (300px) + horizontal padding (15px * 2 = 30px)
    const cssMaxBox = 330;
    // Estimate content width:  font-size px * avg character width factor + padding
    const fontSize = isRos2Node ? 14 : 12;
    const avgCharWidth = fontSize * 0.62; // average character width at given font-size
    const contentPadding = 30; // 15px padding left + right
    const textWidth = label.length * avgCharWidth + contentPadding;
    // CSS will clamp the node to max-width, so our layout width can't exceed that
    const minWidth = isRos2Node ? 170 : 140;
    return Math.max(minWidth, Math.min(textWidth, cssMaxBox));
  };

  const sortLevelNodes = (items) => {
    const typeWeight = { ros2Node: 0, topicNode: 1 };
    return [...items].sort((a, b) => {
      const ta = typeWeight[a.type] ?? 2;
      const tb = typeWeight[b.type] ?? 2;
      if (ta !== tb) return ta - tb;
      const la = a.data?.label || a.id;
      const lb = b.data?.label || b.id;
      return la.localeCompare(lb);
    });
  };

  const layoutedNodes = [];
  let currentY = 0;
  
  sortedLevels.forEach((level) => {
    const levelNodes = sortLevelNodes(levels.get(level));
    
    // Split into rows of maxNodesPerRow
    const rows = [];
    for (let i = 0; i < levelNodes.length; i += maxNodesPerRow) {
      rows.push(levelNodes.slice(i, i + maxNodesPerRow));
    }
    
    rows.forEach((rowNodes) => {
      // Calculate actual widths for each node in this row
      const widths = rowNodes.map(n => getNodeLayoutWidth(n));
      const totalWidth = widths.reduce((sum, w) => sum + w, 0) + (widths.length - 1) * horizontalGap;
      let xCursor = -totalWidth / 2;
      
      rowNodes.forEach((node, i) => {
        layoutedNodes.push({
          ...node,
          position: {
            x: xCursor,
            y: currentY,
          },
        });
        xCursor += widths[i] + horizontalGap;
      });
      
      currentY += verticalGap;
    });
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
