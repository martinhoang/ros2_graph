/**
 * Basic unit tests for layout utility functions
 */

import { describe, it, expect } from 'vitest';
import { layoutGraph } from '../utils/layout';

describe('layoutGraph', () => {
  it('should return nodes and edges arrays', () => {
    const nodes = [
      { id: 'node-1', type: 'ros2Node', data: { label: '/test_node' } },
      { id: 'topic-1', type: 'topicNode', data: { label: '/test_topic' } },
    ];
    const edges = [
      { id: 'edge-1', source: 'node-1', target: 'topic-1' },
    ];

    const result = layoutGraph(nodes, edges, false);

    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
  });

  it('should assign positions to nodes', () => {
    const nodes = [
      { id: 'node-1', type: 'ros2Node', data: { label: '/test' } },
    ];
    const edges = [];

    const result = layoutGraph(nodes, edges, false);

    expect(result.nodes[0]).toHaveProperty('position');
    expect(result.nodes[0].position).toHaveProperty('x');
    expect(result.nodes[0].position).toHaveProperty('y');
    expect(typeof result.nodes[0].position.x).toBe('number');
    expect(typeof result.nodes[0].position.y).toBe('number');
  });

  it('should filter debug nodes when hideDebugNodes is true', () => {
    const nodes = [
      { id: 'node-1', type: 'ros2Node', data: { label: '/test_node' } },
      { id: 'node-2', type: 'ros2Node', data: { label: '/ros_debug' } },
      { id: 'topic-1', type: 'topicNode', data: { label: '/rosout' } },
    ];
    const edges = [];

    const result = layoutGraph(nodes, edges, true);

    // Should filter out /ros_debug and /rosout
    expect(result.nodes.length).toBeLessThan(nodes.length);
    expect(result.nodes.find(n => n.id === 'node-2')).toBeUndefined();
    expect(result.nodes.find(n => n.id === 'topic-1')).toBeUndefined();
  });

  it('should not filter nodes when hideDebugNodes is false', () => {
    const nodes = [
      { id: 'node-1', type: 'ros2Node', data: { label: '/test_node' } },
      { id: 'node-2', type: 'ros2Node', data: { label: '/ros_debug' } },
    ];
    const edges = [];

    const result = layoutGraph(nodes, edges, false);

    expect(result.nodes.length).toBe(nodes.length);
  });

  it('should deduplicate edges', () => {
    const nodes = [
      { id: 'node-1', type: 'ros2Node', data: { label: '/test' } },
      { id: 'topic-1', type: 'topicNode', data: { label: '/topic' } },
    ];
    const edges = [
      { id: 'edge-1', source: 'node-1', target: 'topic-1' },
      { id: 'edge-1', source: 'node-1', target: 'topic-1' }, // duplicate
    ];

    const result = layoutGraph(nodes, edges, false);

    expect(result.edges.length).toBe(1);
  });
});
