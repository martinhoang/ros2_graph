// Track duplicate warnings to avoid spam
const warnedDuplicates = new Set();

/**
 * Iterative DFS back-edge detection.
 *
 * A "back edge" is an edge A→B where B is an ancestor of A in the DFS tree,
 * i.e. it closes a cycle.  We collect them so that level propagation can skip
 * them, turning the (potentially cyclic) graph into a DAG for layout purposes.
 * The edges are still rendered — they just don't influence vertical placement.
 *
 * Uses an explicit stack instead of recursion to avoid stack-overflow on large
 * graphs.
 *
 * @param {string[]} nodeIds
 * @param {Map<string, string[]>} adjacency  node-id → [target-id, …]
 * @returns {Set<string>}  set of "source||target" keys for back edges
 */
function findBackEdges(nodeIds, adjacency) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(nodeIds.map((id) => [id, WHITE]));
  const back = new Set();

  for (const startId of nodeIds) {
    if (color.get(startId) !== WHITE) continue;

    // Stack entries: [nodeId, neighborIndex]
    const stack = [[startId, 0]];
    color.set(startId, GRAY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const u = frame[0];
      const neighbors = adjacency.get(u) ?? [];

      if (frame[1] >= neighbors.length) {
        color.set(u, BLACK);
        stack.pop();
      } else {
        const v = neighbors[frame[1]++];
        if (color.get(v) === GRAY) {
          back.add(`${u}||${v}`); // closing a cycle → back edge
        } else if (color.get(v) === WHITE) {
          color.set(v, GRAY);
          stack.push([v, 0]);
        }
      }
    }
  }

  return back;
}

/**
 * Return the lowest valid level for a node that satisfies type-parity:
 *   ros2Node  → even levels (0, 2, 4, …)
 *   topicNode → odd  levels (1, 3, 5, …)
 *
 * If `floor` already satisfies parity it is returned unchanged; otherwise
 * floor+1 is returned.
 */
function minValidLevel(nodeType, floor) {
  const wantEven = nodeType === 'ros2Node';
  return (floor % 2 === 0) === wantEven ? floor : floor + 1;
}

export const layoutGraph = (nodes, edges, hideDebugNodes = true) => {
  // ─── Phase 1: Filter debug / internal nodes ───────────────────────────────
  let filteredNodes = nodes;
  let filteredEdges = edges;

  if (hideDebugNodes) {
    const debugPatterns = [
      /^\/ros_/,             // ROS2 internal nodes
      /^\/launch_/,          // Launch system nodes
      /_debug$/,             // Nodes ending with _debug
      /^\/_/,                // Nodes starting with /_
      /^\/parameter_events$/, // Parameter events topic
      /^\/rosout$/,          // Rosout topic
      /^\/ros2_graph_service$/, // This package's own service node
      /^\/.*\/_/,            // Topics/nodes with /_ in path
    ];

    const debugIds = new Set();
    filteredNodes = nodes.filter((node) => {
      const isDebug = debugPatterns.some((p) => p.test(node.data.label || ''));
      if (isDebug) debugIds.add(node.id);
      return !isDebug;
    });
    filteredEdges = edges.filter(
      (e) => !debugIds.has(e.source) && !debugIds.has(e.target)
    );
  }

  const nodeById = new Map(filteredNodes.map((n) => [n.id, n]));

  // ─── Phase 2: Build forward adjacency ─────────────────────────────────────
  const adjacency = new Map(filteredNodes.map((n) => [n.id, []]));
  filteredEdges.forEach((e) => {
    if (nodeById.has(e.source) && nodeById.has(e.target)) {
      adjacency.get(e.source).push(e.target);
    }
  });

  // ─── Phase 3: Identify cycle back-edges (remove for level purposes) ───────
  const backEdges = findBackEdges(Array.from(nodeById.keys()), adjacency);

  // ─── Phase 4: Level assignment with type-parity constraint ────────────────
  //
  // Strategy:
  //   • Each node starts at its minimum valid level for its type
  //     (ros2Node → 0,  topicNode → 1).
  //   • We iteratively propagate:  for every edge A→B,
  //     level(B) = max(level(B), minValidLevel(typeOf B, level(A)+1))
  //   • Back edges are skipped to avoid divergence in cycles.
  //   • Iteration stops early when nothing changes (convergence).
  //
  // This guarantees:
  //   1. Publisher node always above its topic (topic = pub_level + 1 or +2 if
  //      parity forces it).
  //   2. Topic always above its subscriber nodes.
  //   3. ros2Nodes and topicNodes are NEVER on the same visual row (different
  //      parity → different level numbers → different rows).
  //   4. Orphan topics (publisher filtered out) start at level 1 (odd), not 0,
  //      so they never mix with source ros2Nodes at level 0.

  const levelMap = new Map(
    filteredNodes.map((n) => [n.id, minValidLevel(n.type, 0)])
  );

  const maxIter = Math.max(filteredNodes.length * 2, 30);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    filteredEdges.forEach((e) => {
      if (!nodeById.has(e.source) || !nodeById.has(e.target)) return;
      if (backEdges.has(`${e.source}||${e.target}`)) return;

      const srcLevel = levelMap.get(e.source) ?? 0;
      const tgtNode = nodeById.get(e.target);
      const needed = minValidLevel(tgtNode.type, srcLevel + 1);

      if ((levelMap.get(e.target) ?? 0) < needed) {
        levelMap.set(e.target, needed);
        changed = true;
      }
    });
    if (!changed) break; // converged
  }

  // ─── Phase 5: Group by level ───────────────────────────────────────────────
  const levelBuckets = new Map();
  filteredNodes.forEach((n) => {
    const lv = levelMap.get(n.id) ?? 0;
    if (!levelBuckets.has(lv)) levelBuckets.set(lv, []);
    levelBuckets.get(lv).push(n);
  });

  // Compact: remap sparse level numbers to consecutive row indices 0,1,2,…
  // so there are no empty visual rows, while preserving relative order.
  const sortedLevelNums = Array.from(levelBuckets.keys()).sort((a, b) => a - b);
  const levelRemap = new Map(sortedLevelNums.map((lv, i) => [lv, i]));
  const rows = new Map();
  levelBuckets.forEach((nodesInLevel, lv) => {
    rows.set(levelRemap.get(lv), nodesInLevel);
  });

  // ─── Phase 6: Within-row sorting by connectivity (degree) ─────────────────
  //
  // "Broadcast" nodes that connect to many peers (e.g. /clock) are sorted
  // first within their row → they end up in the centre of the row, making
  // them visually prominent and easy to spot.
  const degree = new Map(filteredNodes.map((n) => [n.id, 0]));
  filteredEdges.forEach((e) => {
    if (nodeById.has(e.source)) degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    if (nodeById.has(e.target)) degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  });

  const sortRowNodes = (items) =>
    [...items].sort((a, b) => {
      const diff = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
      if (diff !== 0) return diff; // higher degree first
      return (a.data?.label || a.id).localeCompare(b.data?.label || b.id);
    });

  // ─── Phase 7: Assign x/y positions ────────────────────────────────────────
  const horizontalGap = 40;
  const verticalGap = 140;
  const maxNodesPerRow = 8;

  const getNodeLayoutWidth = (node) => {
    const label = node.data?.label || node.id;
    const isRos2Node = node.type === 'ros2Node';
    const cssMaxBox = 330;
    const fontSize = isRos2Node ? 14 : 12;
    const textWidth = label.length * (fontSize * 0.62) + 30;
    return Math.max(isRos2Node ? 170 : 140, Math.min(textWidth, cssMaxBox));
  };

  const layoutedNodes = [];
  let currentY = 0;

  Array.from(rows.keys())
    .sort((a, b) => a - b)
    .forEach((rowIdx) => {
      const rowNodes = sortRowNodes(rows.get(rowIdx));

      // Split into sub-rows if > maxNodesPerRow
      for (let i = 0; i < rowNodes.length; i += maxNodesPerRow) {
        const chunk = rowNodes.slice(i, i + maxNodesPerRow);
        const widths = chunk.map(getNodeLayoutWidth);
        const totalWidth =
          widths.reduce((s, w) => s + w, 0) + (chunk.length - 1) * horizontalGap;
        let x = -totalWidth / 2;

        chunk.forEach((node, j) => {
          layoutedNodes.push({ ...node, position: { x, y: currentY } });
          x += widths[j] + horizontalGap;
        });

        currentY += verticalGap;
      }
    });

  // ─── Deduplicate and style edges ──────────────────────────────────────────
  const seenEdgeIds = new Set();
  const layoutedEdges = filteredEdges
    .filter((edge) => {
      if (seenEdgeIds.has(edge.id)) {
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
      style: { strokeWidth: 2 },
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
