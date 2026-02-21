/**
 * Unit tests for layoutGraph().
 *
 * Each test builds a minimal graph, runs the layout, then asserts Y-positions
 * (rows) and X-positions (order within a row) rather than concrete pixel
 * numbers — so the tests remain valid even when gap/padding constants change.
 *
 * Helpers
 * -------
 *   node(id, type?)   – build a ros2Node (default) or topicNode stub
 *   topic(id)         – shorthand for a topicNode
 *   edge(src, tgt)    – build an edge stub
 *   posMap(result)    – Map<id, {x,y}> from layout result
 */

import { describe, it, expect } from 'vitest';
import { layoutGraph } from '../utils/layout';

// ─── Helpers ────────────────────────────────────────────────────────────────

const node = (id, label) => ({
  id: `node-${id}`,
  type: 'ros2Node',
  data: { label: label ?? `/${id}` },
});

const topic = (id, label) => ({
  id: `topic-${id}`,
  type: 'topicNode',
  data: { label: label ?? `/${id}` },
});

const edge = (src, tgt, suffix = '') => ({
  id: `${src}-${tgt}${suffix}`,
  source: src,
  target: tgt,
});

const posMap = (result) =>
  new Map(result.nodes.map((n) => [n.id, n.position]));

// ─── Basic sanity ────────────────────────────────────────────────────────────

describe('layoutGraph – basic contract', () => {
  it('returns nodes and edges arrays', () => {
    const result = layoutGraph([node('a')], [], false);
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
  });

  it('assigns numeric x/y positions to every node', () => {
    const result = layoutGraph([node('a'), topic('x')], [], false);
    result.nodes.forEach((n) => {
      expect(typeof n.position.x).toBe('number');
      expect(typeof n.position.y).toBe('number');
    });
  });

  it('deduplicates edges with the same id', () => {
    const ns = [node('a'), topic('x')];
    const es = [
      edge('node-a', 'topic-x'),
      edge('node-a', 'topic-x'), // exact duplicate id
    ];
    const result = layoutGraph(ns, es, false);
    expect(result.edges.length).toBe(1);
  });

  it('filters debug nodes when hideDebugNodes=true', () => {
    const ns = [
      node('good', '/good_node'),
      node('bad',  '/ros_bad'),   // debug pattern
      topic('out', '/rosout'),    // debug pattern
    ];
    const result = layoutGraph(ns, [], true);
    expect(result.nodes.find((n) => n.id === 'node-bad')).toBeUndefined();
    expect(result.nodes.find((n) => n.id === 'topic-out')).toBeUndefined();
    expect(result.nodes.find((n) => n.id === 'node-good')).toBeDefined();
  });

  it('keeps all nodes when hideDebugNodes=false', () => {
    const ns = [node('a'), node('b', '/ros_bad')];
    expect(layoutGraph(ns, [], false).nodes.length).toBe(2);
  });
});

// ─── Type-parity: ros2Nodes at even rows, topicNodes at odd rows ─────────────

describe('layoutGraph – type-parity (no mixed rows)', () => {
  it('a standalone ros2Node lands on row 0 (y=0)', () => {
    const result = layoutGraph([node('a')], [], false);
    expect(posMap(result).get('node-a').y).toBe(0);
  });

  it('a standalone topicNode never shares y with a ros2Node at level 0', () => {
    // The real invariant: topics must not mix with ros2Nodes on the same row.
    // Test with both types present so parity enforcement is exercised.
    const ns = [node('a'), topic('x')];
    const result = layoutGraph(ns, [], false);
    const pm = posMap(result);
    expect(pm.get('node-a').y).not.toBe(pm.get('topic-x').y);
    // ros2Node must be on the topmost row (y=0)
    expect(pm.get('node-a').y).toBe(0);
  });

  it('ros2Node and topicNode always have different y values even with no edges', () => {
    const ns = [node('a'), topic('x')];
    const result = layoutGraph(ns, [], false);
    const pm = posMap(result);
    expect(pm.get('node-a').y).not.toBe(pm.get('topic-x').y);
  });
});

// ─── Simple chain: publisher → topic → subscriber ───────────────────────────

describe('layoutGraph – simple publisher→topic→subscriber chain', () => {
  //   node-a  →  topic-x  →  node-b
  const ns = [node('a'), topic('x'), node('b')];
  const es = [
    edge('node-a', 'topic-x'),
    edge('topic-x', 'node-b'),
  ];

  it('publisher is above topic (smaller y)', () => {
    const pm = posMap(layoutGraph(ns, es, false));
    expect(pm.get('node-a').y).toBeLessThan(pm.get('topic-x').y);
  });

  it('topic is above subscriber (smaller y)', () => {
    const pm = posMap(layoutGraph(ns, es, false));
    expect(pm.get('topic-x').y).toBeLessThan(pm.get('node-b').y);
  });

  it('ordering is strictly top→bottom: publisher < topic < subscriber', () => {
    const pm = posMap(layoutGraph(ns, es, false));
    expect(pm.get('node-a').y).toBeLessThan(pm.get('topic-x').y);
    expect(pm.get('topic-x').y).toBeLessThan(pm.get('node-b').y);
  });
});

// ─── Diamond / fan-out ───────────────────────────────────────────────────────

describe('layoutGraph – diamond and fan-out', () => {
  //   node-a → topic-x → node-b
  //          → topic-y → node-b
  it('two paths from the same publisher share the correct relative order', () => {
    const ns = [node('a'), topic('x'), topic('y'), node('b')];
    const es = [
      edge('node-a', 'topic-x'),
      edge('node-a', 'topic-y'),
      edge('topic-x', 'node-b'),
      edge('topic-y', 'node-b'),
    ];
    const pm = posMap(layoutGraph(ns, es, false));
    expect(pm.get('node-a').y).toBeLessThan(pm.get('topic-x').y);
    expect(pm.get('node-a').y).toBeLessThan(pm.get('topic-y').y);
    expect(pm.get('topic-x').y).toBeLessThan(pm.get('node-b').y);
    expect(pm.get('topic-y').y).toBeLessThan(pm.get('node-b').y);
  });
});

// ─── /clock broadcast scenario ───────────────────────────────────────────────
//
// /clock is published by some sim node (may be filtered) and subscribed by
// many nodes.  It should appear near the TOP of the graph in all cases.

describe('layoutGraph – /clock broadcast topic', () => {
  it('/clock topic is above all its subscriber nodes (publisher visible)', () => {
    //   node-sim → topic-clock → node-nav
    //                          → node-ctrl
    //                          → node-sensor
    const ns = [
      node('sim'),
      topic('clock', '/clock'),
      node('nav'),
      node('ctrl'),
      node('sensor'),
    ];
    const es = [
      edge('node-sim',   'topic-clock'),
      edge('topic-clock', 'node-nav'),
      edge('topic-clock', 'node-ctrl'),
      edge('topic-clock', 'node-sensor'),
    ];
    const pm = posMap(layoutGraph(ns, es, false));
    expect(pm.get('topic-clock').y).toBeLessThan(pm.get('node-nav').y);
    expect(pm.get('topic-clock').y).toBeLessThan(pm.get('node-ctrl').y);
    expect(pm.get('topic-clock').y).toBeLessThan(pm.get('node-sensor').y);
    expect(pm.get('node-sim').y).toBeLessThan(pm.get('topic-clock').y);
  });

  it('/clock topic is above all its subscriber nodes (publisher filtered out)', () => {
    // Publisher (/gazebo) is debug-filtered.  /clock has NO incoming edges.
    // It must still be placed ABOVE the subscriber rows, not mixed with them.
    const ns = [
      topic('clock', '/clock'),
      node('nav',    '/nav2'),
      node('ctrl',   '/controller'),
      node('sensor', '/sensor'),
    ];
    const es = [
      edge('topic-clock', 'node-nav'),
      edge('topic-clock', 'node-ctrl'),
      edge('topic-clock', 'node-sensor'),
    ];
    const pm = posMap(layoutGraph(ns, es, false));
    expect(pm.get('topic-clock').y).toBeLessThan(pm.get('node-nav').y);
    expect(pm.get('topic-clock').y).toBeLessThan(pm.get('node-ctrl').y);
    expect(pm.get('topic-clock').y).toBeLessThan(pm.get('node-sensor').y);
  });

  it('/clock (many subscribers) is sorted first (smallest x) within its row', () => {
    // Single topic row: /clock (3 subscribers) and /other (1 subscriber).
    // /clock has higher degree → should appear first (leftmost / smallest x).
    const ns = [
      topic('clock', '/clock'),
      topic('other', '/other'),
      node('a'), node('b'), node('c'), // subscribers of /clock
      node('d'),                       // subscriber of /other
    ];
    const es = [
      edge('topic-clock', 'node-a'),
      edge('topic-clock', 'node-b'),
      edge('topic-clock', 'node-c'),
      edge('topic-other', 'node-d'),
    ];
    const pm = posMap(layoutGraph(ns, es, false));
    // Both topics should be at the same y (same row, no publisher forcing different levels)
    expect(pm.get('topic-clock').y).toBe(pm.get('topic-other').y);
    // /clock has more connections → smaller x (placed first / leftmost in centred row)
    expect(pm.get('topic-clock').x).toBeLessThan(pm.get('topic-other').x);
  });
});

// ─── Cycle handling ──────────────────────────────────────────────────────────

describe('layoutGraph – cycle handling', () => {
  //  Typical ROS2 feedback loop:
  //  node-gazebo → topic-clock → node-nav → topic-cmd → node-gazebo  (cycle!)

  const ns = [
    node('gazebo'),
    topic('clock', '/clock'),
    node('nav'),
    topic('cmd',   '/cmd_vel'),
  ];
  const es = [
    edge('node-gazebo', 'topic-clock'),
    edge('topic-clock', 'node-nav'),
    edge('node-nav',    'topic-cmd'),
    edge('topic-cmd',   'node-gazebo'), // feedback / back edge
  ];

  it('does not throw on a cyclic graph', () => {
    expect(() => layoutGraph(ns, es, false)).not.toThrow();
  });

  it('returns the correct number of nodes and edges', () => {
    const result = layoutGraph(ns, es, false);
    expect(result.nodes.length).toBe(4);
    expect(result.edges.length).toBe(4);
  });

  it('preserves publisher→topic→subscriber order on the non-feedback path', () => {
    const pm = posMap(layoutGraph(ns, es, false));
    // The acyclic chain: gazebo < clock < nav < cmd
    expect(pm.get('node-gazebo').y).toBeLessThan(pm.get('topic-clock').y);
    expect(pm.get('topic-clock').y).toBeLessThan(pm.get('node-nav').y);
    expect(pm.get('node-nav').y).toBeLessThan(pm.get('topic-cmd').y);
  });
});

// ─── Multi-level chain ───────────────────────────────────────────────────────

describe('layoutGraph – multi-level chain', () => {
  // node-a → topic-x → node-b → topic-y → node-c → topic-z → node-d
  it('a 4-level chain has strictly increasing y values', () => {
    const ns = [node('a'), topic('x'), node('b'), topic('y'), node('c'), topic('z'), node('d')];
    const es = [
      edge('node-a',  'topic-x'),
      edge('topic-x', 'node-b'),
      edge('node-b',  'topic-y'),
      edge('topic-y', 'node-c'),
      edge('node-c',  'topic-z'),
      edge('topic-z', 'node-d'),
    ];
    const pm = posMap(layoutGraph(ns, es, false));
    const ys = ['node-a', 'topic-x', 'node-b', 'topic-y', 'node-c', 'topic-z', 'node-d']
      .map((id) => pm.get(id).y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
  });
});

// ─── Disconnected graph ──────────────────────────────────────────────────────

describe('layoutGraph – disconnected components', () => {
  it('positions all nodes even with no edges', () => {
    const ns = [node('a'), node('b'), topic('x'), topic('y')];
    const result = layoutGraph(ns, [], false);
    expect(result.nodes.length).toBe(4);
    result.nodes.forEach((n) => {
      expect(typeof n.position.x).toBe('number');
      expect(typeof n.position.y).toBe('number');
    });
  });

  it('independent chains do not share y with each other at wrong levels', () => {
    // Chain 1: node-a → topic-x → node-b
    // Chain 2: node-c → topic-y → node-d  (independent)
    const ns = [node('a'), topic('x'), node('b'), node('c'), topic('y'), node('d')];
    const es = [
      edge('node-a', 'topic-x'),
      edge('topic-x', 'node-b'),
      edge('node-c', 'topic-y'),
      edge('topic-y', 'node-d'),
    ];
    const pm = posMap(layoutGraph(ns, es, false));
    // Both chains: publisher < topic < subscriber
    expect(pm.get('node-a').y).toBeLessThan(pm.get('topic-x').y);
    expect(pm.get('topic-x').y).toBeLessThan(pm.get('node-b').y);
    expect(pm.get('node-c').y).toBeLessThan(pm.get('topic-y').y);
    expect(pm.get('topic-y').y).toBeLessThan(pm.get('node-d').y);
  });
});

