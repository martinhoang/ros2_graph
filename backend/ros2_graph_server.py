#!/usr/bin/env python3
"""
ROS2 Graph Backend Service
Provides REST API to query ROS2 graph information
"""

import rclpy
from rclpy.node import Node
from rclpy.serialization import deserialize_message
from rosidl_runtime_py.utilities import get_message
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
        self.topic_subscriptions = {}  # Store active subscriptions
        self.latest_messages = {}  # Store latest messages for each topic
        self.subscription_lock = threading.Lock()

    def subscribe_to_topic(self, topic_name, topic_type):
        """Subscribe to a topic and store the latest message"""
        with self.subscription_lock:
            # If already subscribed, return
            if topic_name in self.topic_subscriptions:
                return True
            
            try:
                # Get the message class dynamically
                msg_module_name, msg_class_name = topic_type.rsplit('/', 1)
                msg_module = get_message(topic_type)
                
                # Create a callback to store the latest message
                def callback(msg):
                    # Convert message to dictionary
                    msg_dict = self._message_to_dict(msg)
                    with self.subscription_lock:
                        self.latest_messages[topic_name] = {
                            'data': msg_dict,
                            'timestamp': time.time()
                        }
                
                # Create subscription
                subscription = self.create_subscription(
                    msg_module,
                    topic_name,
                    callback,
                    10
                )
                
                self.topic_subscriptions[topic_name] = subscription
                self.get_logger().info(f'Subscribed to topic: {topic_name}')
                return True
                
            except Exception as e:
                self.get_logger().error(f'Error subscribing to topic {topic_name}: {str(e)}')
                return False
    
    def unsubscribe_from_topic(self, topic_name):
        """Unsubscribe from a topic"""
        with self.subscription_lock:
            if topic_name in self.topic_subscriptions:
                self.destroy_subscription(self.topic_subscriptions[topic_name])
                del self.topic_subscriptions[topic_name]
                if topic_name in self.latest_messages:
                    del self.latest_messages[topic_name]
                self.get_logger().info(f'Unsubscribed from topic: {topic_name}')
    
    def get_latest_message(self, topic_name):
        """Get the latest message for a topic"""
        with self.subscription_lock:
            return self.latest_messages.get(topic_name)
    
    def _message_to_dict(self, msg):
        """Convert a ROS2 message to a dictionary"""
        result = {}
        for field_name in msg.get_fields_and_field_types().keys():
            value = getattr(msg, field_name)
            # Handle nested messages
            if hasattr(value, 'get_fields_and_field_types'):
                result[field_name] = self._message_to_dict(value)
            # Handle arrays/lists
            elif isinstance(value, (list, tuple)):
                result[field_name] = [
                    self._message_to_dict(item) if hasattr(item, 'get_fields_and_field_types') else item
                    for item in value
                ]
            else:
                result[field_name] = value
        return result

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


@sock.route('/ws/topic/<path:topic_name>')
def ws_topic(ws, topic_name):
  """WebSocket endpoint for streaming topic messages"""
  if not topic_name.startswith('/'):
    topic_name = '/' + topic_name
  
  stop_streaming = threading.Event()
  
  def receive_messages():
    """Thread to receive messages from client"""
    try:
      while not stop_streaming.is_set():
        msg = ws.receive()
        if msg == 'close':
          stop_streaming.set()
          break
    except Exception:
      stop_streaming.set()
  
  try:
    if ros2_node is None:
      ws.send(json.dumps({'error': 'ROS2 node not initialized'}))
      return
    
    # Get topic type
    topic_names_and_types = ros2_node.get_topic_names_and_types()
    topic_type = None
    for name, types in topic_names_and_types:
      if name == topic_name:
        topic_type = types[0] if types else None
        break
    
    if not topic_type:
      ws.send(json.dumps({'error': 'Topic not found'}))
      return
    
    # Subscribe to the topic
    if not ros2_node.subscribe_to_topic(topic_name, topic_type):
      ws.send(json.dumps({'error': 'Failed to subscribe to topic'}))
      return
    
    # Start receive thread
    receive_thread = threading.Thread(target=receive_messages, daemon=True)
    receive_thread.start()
    
    # Stream messages
    last_timestamp = 0
    while not stop_streaming.is_set():
      latest_msg = ros2_node.get_latest_message(topic_name)
      if latest_msg and latest_msg['timestamp'] > last_timestamp:
        try:
          ws.send(json.dumps({
            'type': 'message',
            'topic': topic_name,
            'data': latest_msg['data'],
            'timestamp': latest_msg['timestamp']
          }))
          last_timestamp = latest_msg['timestamp']
        except Exception:
          break
      
      time.sleep(0.05)  # 20Hz update rate
      
  except Exception as e:
    try:
      ws.send(json.dumps({'error': str(e)}))
    except Exception:
      pass
  finally:
    stop_streaming.set()
    # Unsubscribe when connection closes
    if ros2_node:
      ros2_node.unsubscribe_from_topic(topic_name)


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
        
        # Flask's <path:> converter already handles the path correctly
        # Just ensure it starts with /
        if not node_name.startswith('/'):
            node_name = '/' + node_name
        
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
        
        # Flask's <path:> converter already handles the path correctly
        # Just ensure it starts with /
        if not topic_name.startswith('/'):
            topic_name = '/' + topic_name
        
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
