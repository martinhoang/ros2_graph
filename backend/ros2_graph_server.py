#!/usr/bin/env python3
"""
ROS2 Graph Backend Service
Provides REST API to query ROS2 graph information
"""

import rclpy
from rclpy.node import Node
from flask import Flask, jsonify
from flask_cors import CORS
from flask_sock import Sock
import threading
import signal
import sys
import atexit
import argparse
import json
import time

class ROS2GraphService(Node):
    def __init__(self):
        super().__init__('ros2_graph_service')
        self.get_logger().info('ROS2 Graph Service initialized')

    def get_graph_data(self):
        """Get complete ROS2 graph data including nodes, topics, and connections"""
        try:
            # Get all node names
            node_names_and_namespaces = self.get_node_names_and_namespaces()
            
            # Get all topic names and types
            topic_names_and_types = self.get_topic_names_and_types()
            
            nodes = []
            topics = []
            edges = []
            
            node_id_map = {}
            topic_id_map = {}
            
            # Process nodes
            for idx, (node_name, namespace) in enumerate(node_names_and_namespaces):
                full_node_name = f"{namespace}{node_name}".replace('//', '/')
                node_id = f"node-{full_node_name}"
                node_id_map[full_node_name] = node_id
                
                nodes.append({
                    'id': node_id,
                    'type': 'ros2Node',
                    'position': {'x': 0, 'y': idx * 150},
                    'data': {
                        'label': full_node_name,
                        'namespace': namespace if namespace != '/' else ''
                    }
                })
            
            # Process topics
            for idx, (topic_name, topic_types) in enumerate(topic_names_and_types):
                topic_id = f"topic-{topic_name}"
                topic_id_map[topic_name] = topic_id
                
                # Get publishers and subscribers for this topic
                publishers = self.get_publishers_info_by_topic(topic_name)
                subscribers = self.get_subscriptions_info_by_topic(topic_name)
                
                message_type = topic_types[0] if topic_types else 'unknown'
                
                topics.append({
                    'id': topic_id,
                    'type': 'topicNode',
                    'position': {'x': 300, 'y': idx * 150},
                    'data': {
                        'label': topic_name,
                        'messageType': message_type,
                        'publisherCount': len(publishers),
                        'subscriberCount': len(subscribers)
                    }
                })
                
                # Create edges for publishers (node -> topic)
                for pub_info in publishers:
                    node_name = pub_info.node_name
                    namespace = pub_info.node_namespace
                    full_node_name = f"{namespace}{node_name}".replace('//', '/')
                    
                    if full_node_name in node_id_map:
                        edge_id = f"{node_id_map[full_node_name]}-{topic_id}-pub"
                        edges.append({
                            'id': edge_id,
                            'source': node_id_map[full_node_name],
                            'target': topic_id,
                            'data': {'type': 'publisher'}
                        })
                
                # Create edges for subscribers (topic -> node)
                for sub_info in subscribers:
                    node_name = sub_info.node_name
                    namespace = sub_info.node_namespace
                    full_node_name = f"{namespace}{node_name}".replace('//', '/')
                    
                    if full_node_name in node_id_map:
                        edge_id = f"{topic_id}-{node_id_map[full_node_name]}-sub"
                        edges.append({
                            'id': edge_id,
                            'source': topic_id,
                            'target': node_id_map[full_node_name],
                            'data': {'type': 'subscriber'}
                        })
            
            return {
                'nodes': nodes + topics,
                'edges': edges
            }
            
        except Exception as e:
            self.get_logger().error(f'Error getting graph data: {str(e)}')
            raise

    def get_node_details(self, node_name):
        """Get detailed information about a specific node"""
        try:
            # Get node names
            node_names_and_namespaces = self.get_node_names_and_namespaces()
            
            for name, namespace in node_names_and_namespaces:
                full_name = f"{namespace}{name}".replace('//', '/')
                if full_name == node_name:
                    # Get publishers and subscriptions for this node
                    all_topics = self.get_topic_names_and_types()
                    
                    publishers = []
                    subscribers = []
                    
                    for topic_name, _ in all_topics:
                        pubs = self.get_publishers_info_by_topic(topic_name)
                        for pub in pubs:
                            pub_full_name = f"{pub.node_namespace}{pub.node_name}".replace('//', '/')
                            if pub_full_name == node_name:
                                publishers.append(topic_name)
                        
                        subs = self.get_subscriptions_info_by_topic(topic_name)
                        for sub in subs:
                            sub_full_name = f"{sub.node_namespace}{sub.node_name}".replace('//', '/')
                            if sub_full_name == node_name:
                                subscribers.append(topic_name)
                    
                    return {
                        'name': full_name,
                        'namespace': namespace,
                        'publishers': publishers,
                        'subscribers': subscribers
                    }
            
            return None
            
        except Exception as e:
            self.get_logger().error(f'Error getting node details: {str(e)}')
            raise

    def get_topic_details(self, topic_name):
        """Get detailed information about a specific topic"""
        try:
            topic_names_and_types = self.get_topic_names_and_types()
            
            for name, types in topic_names_and_types:
                if name == topic_name:
                    publishers = self.get_publishers_info_by_topic(topic_name)
                    subscribers = self.get_subscriptions_info_by_topic(topic_name)
                    
                    pub_nodes = [
                        f"{pub.node_namespace}{pub.node_name}".replace('//', '/')
                        for pub in publishers
                    ]
                    
                    sub_nodes = [
                        f"{sub.node_namespace}{sub.node_name}".replace('//', '/')
                        for sub in subscribers
                    ]
                    
                    return {
                        'name': topic_name,
                        'types': types,
                        'publishers': pub_nodes,
                        'subscribers': sub_nodes
                    }
            
            return None
            
        except Exception as e:
            self.get_logger().error(f'Error getting topic details: {str(e)}')
            raise


# Flask app
app = Flask(__name__)
CORS(app)
sock = Sock(app)

# Global ROS2 node and WebSocket clients
ros2_node = None
ros2_thread = None
ws_clients = []
graph_update_thread = None
last_graph_data = None


def graph_update_loop():
  """Background thread to push updates to all connected WebSocket clients"""
  global last_graph_data
  
  while True:
    try:
      if ros2_node is None:
        time.sleep(1)
        continue
      
      current_graph = ros2_node.get_graph_data()
      
      # Only send if graph changed
      if current_graph != last_graph_data and ws_clients:
        last_graph_data = current_graph
        message = json.dumps({'type': 'graph_update', 'data': current_graph})
        
        # Send to all connected clients
        dead_clients = []
        for client in ws_clients:
          try:
            client.send(message)
          except Exception as e:
            dead_clients.append(client)
        
        # Remove dead clients
        for client in dead_clients:
          if client in ws_clients:
            ws_clients.remove(client)
      
      time.sleep(0.5)
    except Exception:
      time.sleep(1)


@sock.route('/ws/graph')
def ws_graph(ws):
  """WebSocket endpoint for real-time graph updates"""
  ws_clients.append(ws)
  try:
    # Send initial graph data
    if ros2_node:
      graph = ros2_node.get_graph_data()
      ws.send(json.dumps({'type': 'graph_update', 'data': graph}))
    
    # Keep connection open
    while True:
      msg = ws.receive()
      if msg == 'ping':
        ws.send('pong')
  except Exception:
    pass
  finally:
    if ws in ws_clients:
      ws_clients.remove(ws)


# Global ROS2 node
ros2_node = None
ros2_thread = None


def ros2_spin():
    """Spin ROS2 node in separate thread"""
    rclpy.spin(ros2_node)


@app.route('/api/graph', methods=['GET'])
def get_graph():
    """Get complete graph data"""
    try:
        if ros2_node is None:
            return jsonify({'error': 'ROS2 node not initialized'}), 500
        
        data = ros2_node.get_graph_data()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/node/<path:node_name>', methods=['GET'])
def get_node(node_name):
    """Get specific node details"""
    try:
        if ros2_node is None:
            return jsonify({'error': 'ROS2 node not initialized'}), 500
        
        data = ros2_node.get_node_details(node_name)
        if data is None:
            return jsonify({'error': 'Node not found'}), 404
        
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/topic/<path:topic_name>', methods=['GET'])
def get_topic(topic_name):
    """Get specific topic details"""
    try:
        if ros2_node is None:
            return jsonify({'error': 'ROS2 node not initialized'}), 500
        
        data = ros2_node.get_topic_details(topic_name)
        if data is None:
            return jsonify({'error': 'Topic not found'}), 404
        
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'ros2_initialized': ros2_node is not None})


def main():
    global ros2_node, ros2_thread
    global graph_update_thread
    
    parser = argparse.ArgumentParser(description="ROS2 Graph Backend Server")
    parser.add_argument("--port", type=int, default=5000, help="Port to bind the Flask server (default: 5000)")
    args = parser.parse_args()
    
    def cleanup():
        """Cleanup function to properly shutdown ROS2 and Flask"""
        print("\nShutting down ROS2 Graph Service...")
        try:
            if ros2_node is not None:
                ros2_node.destroy_node()
            if rclpy.ok():
                rclpy.shutdown()
        except Exception as e:
            print(f"Error during cleanup: {e}")
        sys.exit(0)
    
    # Register cleanup handlers
    atexit.register(cleanup)
    signal.signal(signal.SIGINT, lambda sig, frame: cleanup())
    signal.signal(signal.SIGTERM, lambda sig, frame: cleanup())
    
    # Initialize ROS2
    try:
        rclpy.init()
    except Exception as e:
        print(f"Failed to initialize ROS2: {e}")
        sys.exit(1)
    
    ros2_node = ROS2GraphService()
    
    # Start ROS2 spinning in separate thread
    ros2_thread = threading.Thread(target=ros2_spin, daemon=True)
    ros2_thread.start()
    
    print(f"Starting ROS2 Graph Backend Server on http://localhost:{args.port}")
    print("API endpoints:")
    print("  GET /api/graph - Get complete graph data")
    print("  GET /api/node/<node_name> - Get node details")
    print("  GET /api/topic/<topic_name> - Get topic details")
    print("  GET /api/health - Health check")
    print("  WebSocket /ws/graph - Real-time graph updates")
    
    # Start graph update thread
    graph_update_thread = threading.Thread(target=graph_update_loop, daemon=True)
    graph_update_thread.start()
    
    try:
        # Run Flask app
        app.run(host='0.0.0.0', port=args.port, debug=False, threaded=True, use_reloader=False)
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()


if __name__ == '__main__':
    main()
