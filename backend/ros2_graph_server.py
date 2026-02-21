#!/usr/bin/env python3
"""
ROS2 Graph Backend Service
Provides REST API to query ROS2 graph information
"""

import rclpy
from rclpy.node import Node
from rclpy.serialization import deserialize_message
from rclpy.qos import QoSProfile, QoSReliabilityPolicy, QoSDurabilityPolicy, QoSHistoryPolicy
from rosidl_runtime_py.utilities import get_message
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_sock import Sock
import threading
import signal
import sys
import os
import atexit
import argparse
import json
import time
import base64
import array as _array_module
import math
from server_logging import configure_access_logging

class ROS2GraphService(Node):
    def __init__(self):
        super().__init__('ros2_graph_service')
        self.get_logger().info('ROS2 Graph Service initialized')
        self.topic_subscriptions = {}  # Store active subscriptions
        self.latest_messages = {}  # Store latest messages for each topic
        self.subscription_lock = threading.Lock()

    def subscribe_to_topic(self, topic_name, topic_type):
        """Subscribe to a topic and store the latest message, with auto QoS detection"""
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
                
                # Auto-detect QoS from existing publishers
                qos_profile = self._detect_topic_qos(topic_name)
                
                # Create subscription with matched QoS
                subscription = self.create_subscription(
                    msg_module,
                    topic_name,
                    callback,
                    qos_profile
                )
                
                self.topic_subscriptions[topic_name] = subscription
                self.get_logger().debug(
                    f'Subscribed to topic: {topic_name} '
                    f'(reliability={qos_profile.reliability.name}, '
                    f'durability={qos_profile.durability.name})'
                )
                return True
                
            except Exception as e:
                self.get_logger().error(f'Error subscribing to topic {topic_name}: {str(e)}')
                return False

    def _detect_topic_qos(self, topic_name):
        """Auto-detect compatible QoS profile from existing publishers on a topic.
        
        Uses the most permissive settings to be compatible with all publishers:
        - If any publisher uses BEST_EFFORT reliability, use BEST_EFFORT
        - If any publisher uses VOLATILE durability, use VOLATILE
        """
        qos = QoSProfile(
            depth=10,
            history=QoSHistoryPolicy.KEEP_LAST,
            reliability=QoSReliabilityPolicy.RELIABLE,
            durability=QoSDurabilityPolicy.VOLATILE,
        )
        
        try:
            pub_info_list = self.get_publishers_info_by_topic(topic_name)
            if pub_info_list:
                for pub_info in pub_info_list:
                    pub_qos = pub_info.qos_profile
                    # If any publisher uses BEST_EFFORT, subscriber must also
                    # (RELIABLE sub cannot receive from BEST_EFFORT pub)
                    if pub_qos.reliability == QoSReliabilityPolicy.BEST_EFFORT:
                        qos.reliability = QoSReliabilityPolicy.BEST_EFFORT
                    # If any publisher is VOLATILE, match it
                    if pub_qos.durability == QoSDurabilityPolicy.VOLATILE:
                        qos.durability = QoSDurabilityPolicy.VOLATILE
                
                self.get_logger().debug(
                    f'QoS detected for {topic_name}: '
                    f'reliability={qos.reliability.name}, '
                    f'durability={qos.durability.name} '
                    f'(from {len(pub_info_list)} publisher(s))'
                )
        except Exception as e:
            self.get_logger().warn(f'Could not detect QoS for {topic_name}: {e}, using defaults')
        
        return qos
    
    def unsubscribe_from_topic(self, topic_name):
        """Unsubscribe from a topic"""
        with self.subscription_lock:
            if topic_name in self.topic_subscriptions:
                self.destroy_subscription(self.topic_subscriptions[topic_name])
                del self.topic_subscriptions[topic_name]
                if topic_name in self.latest_messages:
                    del self.latest_messages[topic_name]
                self.get_logger().debug(f'Unsubscribed from topic: {topic_name}')
    
    def get_latest_message(self, topic_name):
        """Get the latest message for a topic"""
        with self.subscription_lock:
            return self.latest_messages.get(topic_name)

    def reset_runtime_state(self):
        """Clear transient runtime state so clients can force a fresh cycle."""
        with self.subscription_lock:
            for subscription in self.topic_subscriptions.values():
                try:
                    self.destroy_subscription(subscription)
                except Exception:
                    pass
            self.topic_subscriptions.clear()
            self.latest_messages.clear()
    
    def _message_to_dict(self, msg):
        """Convert a ROS2 message to a dictionary with special handling for sensor types"""
        msg_class_name = type(msg).__name__
        
        # Special handling for CompressedImage - send base64 encoded data
        if msg_class_name == 'CompressedImage':
            try:
                img_data = bytes(msg.data)
                if len(img_data) == 0:
                    return {
                        '_msg_type': 'compressed_image',
                        'format': msg.format,
                        'error': f'Empty image data (format: {msg.format}). The publisher may be failing to compress.'
                    }
                
                # Determine image format for the data URI
                fmt = msg.format.lower()
                self.get_logger().debug(f"CompressedImage format: '{msg.format}' (lowercase: '{fmt}')")
                if 'jpeg' in fmt or 'jpg' in fmt:
                    self.get_logger().debug(f"Matched JPEG branch")
                    mime_format = 'jpeg'
                elif 'compresseddepth' in fmt or 'tiff' in fmt:
                    self.get_logger().debug(f"Matched compressedDepth branch - processing depth data")
                    # Check for compressedDepth BEFORE plain png to avoid matching 'png; compressedDepth'
                    # as plain png
                    # compressedDepth uses a 12-byte config header:
                    #   float32 depthQuantA, float32 depthQuantB, int32 format
                    # followed by PNG (or RVL) compressed data.
                    try:
                        import numpy as np
                        import cv2
                        import struct as _struct
                        
                        HEADER_SIZE = 12  # 4 + 4 + 4 bytes
                        if len(img_data) <= HEADER_SIZE:
                            return {
                                '_msg_type': 'image_metadata',
                                'format': msg.format,
                                'data_size': len(img_data),
                                'error': f'compressedDepth data too small ({len(img_data)} bytes)'
                            }
                        
                        depth_quant_a, depth_quant_b = _struct.unpack_from('<ff', img_data, 0)
                        # Remaining bytes after 12-byte header are the PNG image
                        png_data = img_data[HEADER_SIZE:]
                        np_arr = np.frombuffer(png_data, np.uint8)
                        decoded = cv2.imdecode(np_arr, cv2.IMREAD_ANYCOLOR | cv2.IMREAD_ANYDEPTH)
                        
                        if decoded is None:
                            return {
                                '_msg_type': 'image_metadata',
                                'format': msg.format,
                                'data_size': len(img_data),
                                'error': 'Failed to decode compressedDepth PNG payload'
                            }
                        
                        # Dequantize: for 32FC1 the PNG stores quantized uint16
                        # depth = depthQuantA / (uint16_value - depthQuantB)
                        if '32fc1' in fmt and decoded.dtype == np.uint16:
                            decoded = decoded.astype(np.float32)
                            mask = decoded > 0
                            depth_float = np.zeros_like(decoded, dtype=np.float32)
                            depth_float[mask] = depth_quant_a / (decoded[mask] - depth_quant_b)
                            decoded = depth_float
                        
                        # Normalize to 8-bit for display
                        if decoded.dtype != np.uint8:
                            valid = decoded[(decoded > 0) & np.isfinite(decoded)] if decoded.size > 0 else decoded
                            if valid.size > 0:
                                min_val, max_val = float(valid.min()), float(valid.max())
                                if max_val > min_val:
                                    display = np.clip((decoded - min_val) / (max_val - min_val) * 255, 0, 255).astype(np.uint8)
                                else:
                                    display = np.zeros_like(decoded, dtype=np.uint8)
                            else:
                                display = np.zeros_like(decoded, dtype=np.uint8)
                        else:
                            display = decoded
                        
                        # Apply a colormap for depth visualization
                        if len(display.shape) == 2:
                            display = cv2.applyColorMap(display, cv2.COLORMAP_JET)
                        _, encoded = cv2.imencode('.jpg', display, [cv2.IMWRITE_JPEG_QUALITY, 85])
                        self.get_logger().debug(f"Successfully processed compressedDepth: shape={display.shape}, encoded size={len(encoded)}")
                        return {
                            '_msg_type': 'compressed_image',
                            'format': 'jpeg',
                            'data': base64.b64encode(encoded.tobytes()).decode('utf-8'),
                            'original_format': msg.format,
                            'header': self._message_to_dict(msg.header) if hasattr(msg, 'header') else {}
                        }
                    except ImportError:
                        self.get_logger().debug(f"compressedDepth processing failed: numpy/cv2 not available")
                        return {
                            '_msg_type': 'image_metadata',
                            'format': msg.format,
                            'data_size': len(img_data),
                            'error': 'Cannot render compressedDepth: numpy/cv2 not available'
                        }
                    except Exception as e:
                        self.get_logger().debug(f"compressedDepth processing failed with exception: {e}")
                        return {
                            '_msg_type': 'image_metadata',
                            'format': msg.format,
                            'data_size': len(img_data),
                            'error': f'compressedDepth decode error: {e}'
                        }
                elif 'png' in fmt:
                    self.get_logger().debug(f"Matched plain PNG branch")
                    mime_format = 'png'
                else:
                    self.get_logger().debug(f"Matched default (JPEG) branch")
                    mime_format = 'jpeg'  # Default assumption
                
                return {
                    '_msg_type': 'compressed_image',
                    'format': mime_format,
                    'data': base64.b64encode(img_data).decode('utf-8'),
                    'original_format': msg.format,
                    'header': self._message_to_dict(msg.header) if hasattr(msg, 'header') else {}
                }
            except Exception as e:
                return {'_msg_type': 'compressed_image', 'error': str(e)}
        
        # Special handling for raw Image - convert to JPEG base64
        if msg_class_name == 'Image':
            return self._raw_image_to_dict(msg)
        
        # Special handling for PointCloud2 - extract xyz+rgb for 3D rendering
        if msg_class_name == 'PointCloud2':
            result = {
                '_msg_type': 'pointcloud2',
                'height': msg.height,
                'width': msg.width,
                'fields': [
                    {'name': f.name, 'offset': f.offset, 'datatype': f.datatype, 'count': f.count}
                    for f in msg.fields
                ],
                'point_step': msg.point_step,
                'row_step': msg.row_step,
                'is_dense': msg.is_dense,
                'data_size': len(msg.data),
                'header': self._message_to_dict(msg.header) if hasattr(msg, 'header') else {}
            }
            # Try to extract actual point data for 3D rendering
            pc_data = self._extract_pointcloud_data(msg)
            if pc_data:
                result.update(pc_data)
            return result
            
        # Special handling for LaserScan - convert to pointcloud format for 3D rendering
        if msg_class_name == 'LaserScan':
            result = {
                '_msg_type': 'laserscan',
                'header': self._message_to_dict(msg.header) if hasattr(msg, 'header') else {},
                'angle_min': msg.angle_min,
                'angle_max': msg.angle_max,
                'angle_increment': msg.angle_increment,
                'range_min': msg.range_min,
                'range_max': msg.range_max,
            }
            pc_data = self._extract_laserscan_data(msg)
            if pc_data:
                result.update(pc_data)
            return result

        # Generic message handling
        result = {}
        for field_name in msg.get_fields_and_field_types().keys():
            value = getattr(msg, field_name)
            result[field_name] = self._value_to_json_safe(value)
        return result

    def _value_to_json_safe(self, value):
        """Convert a value to a JSON-serializable representation"""
        # Nested ROS2 message
        if hasattr(value, 'get_fields_and_field_types'):
            return self._message_to_dict(value)
        # Bytes / bytearray
        if isinstance(value, (bytes, bytearray)):
            if len(value) > 256:
                return f'<binary: {len(value)} bytes>'
            return list(value)
        # array.array (common for uint8[] fields in ROS2)
        if isinstance(value, _array_module.array):
            if len(value) > 256:
                return f'<array[{len(value)}]>'
            return list(value)
        # Lists / tuples
        if isinstance(value, (list, tuple)):
            if len(value) > 200:
                items = [self._value_to_json_safe(item) for item in value[:200]]
                items.append(f'... ({len(value) - 200} more items)')
                return items
            return [self._value_to_json_safe(item) for item in value]
        # Float special values (JSON doesn't support inf/nan)
        if isinstance(value, float):
            if math.isinf(value) or math.isnan(value):
                return str(value)
            return value
        # Primitive types
        if isinstance(value, (int, str, bool)) or value is None:
            return value
        # Try numpy types
        try:
            import numpy as np
            if isinstance(value, np.integer):
                return int(value)
            if isinstance(value, np.floating):
                v = float(value)
                return str(v) if math.isinf(v) or math.isnan(v) else v
            if isinstance(value, np.ndarray):
                if value.size > 256:
                    return f'<ndarray shape={value.shape} dtype={value.dtype}>'
                return value.tolist()
        except ImportError:
            pass
        # Fallback
        return str(value)

    def _extract_laserscan_data(self, msg, max_points=150000):
        """Convert LaserScan to XYZ positions and colors for 3D rendering."""
        try:
            import numpy as np
            
            ranges = np.array(msg.ranges, dtype=np.float32)
            intensities = np.array(msg.intensities, dtype=np.float32) if msg.intensities else None
            
            # Calculate angles
            angles = msg.angle_min + np.arange(len(msg.ranges), dtype=np.float32) * msg.angle_increment
            
            # Filter out invalid ranges
            valid_mask = np.isfinite(ranges) & (ranges >= msg.range_min) & (ranges <= msg.range_max)
            ranges = ranges[valid_mask]
            angles = angles[valid_mask]
            
            if len(ranges) == 0:
                return None
                
            # Convert polar to Cartesian
            x = ranges * np.cos(angles)
            y = ranges * np.sin(angles)
            z = np.zeros_like(x)
            
            positions = np.column_stack((x, y, z))
            num_points = len(positions)
            
            # Colors based on intensity or range
            if intensities is not None and len(intensities) == len(msg.ranges):
                intensities = intensities[valid_mask]
                i_min, i_max = float(intensities.min()), float(intensities.max())
                if i_max > i_min:
                    norm = np.clip((intensities - i_min) / (i_max - i_min) * 255, 0, 255).astype(np.uint8)
                else:
                    norm = np.full(num_points, 128, dtype=np.uint8)
            else:
                # Color by range
                r_min, r_max = float(ranges.min()), float(ranges.max())
                if r_max > r_min:
                    norm = np.clip((ranges - r_min) / (r_max - r_min) * 255, 0, 255).astype(np.uint8)
                else:
                    norm = np.full(num_points, 128, dtype=np.uint8)
                    
            try:
                import cv2
                colored = cv2.applyColorMap(norm.reshape(-1, 1), cv2.COLORMAP_TURBO).reshape(-1, 3)
                colors = colored[:, ::-1].copy()  # BGR -> RGB
            except ImportError:
                colors = np.column_stack([norm, 255 - norm, np.full(num_points, 128, dtype=np.uint8)])
                
            # Downsample if too many points
            if num_points > max_points:
                indices = np.random.choice(num_points, max_points, replace=False)
                positions = positions[indices]
                colors = colors[indices]
                num_points = max_points

            # Compute bounds for camera setup
            bounds_min = positions.min(axis=0).tolist()
            bounds_max = positions.max(axis=0).tolist()

            return {
                'positions': base64.b64encode(positions.astype(np.float32).tobytes()).decode('utf-8'),
                'colors': base64.b64encode(colors.astype(np.uint8).tobytes()).decode('utf-8'),
                'num_points': int(num_points),
                'bounds': {'min': bounds_min, 'max': bounds_max},
            }
        except Exception as e:
            self.get_logger().warn(f'LaserScan data extraction failed: {e}')
            return None

    def _extract_pointcloud_data(self, msg, max_points=150000):
        """Extract XYZ positions and RGB colors from a PointCloud2 message for 3D rendering."""
        try:
            import numpy as np

            num_points = msg.width * msg.height
            if num_points == 0:
                return None

            point_step = msg.point_step
            data = bytes(msg.data)

            # PointCloud2 field datatype mapping to numpy dtype
            DTYPE_MAP = {
                1: np.int8, 2: np.uint8, 3: np.int16, 4: np.uint16,
                5: np.int32, 6: np.uint32, 7: np.float32, 8: np.float64
            }

            # Build field lookup: name -> (offset, numpy_dtype)
            field_info = {}
            for f in msg.fields:
                dt = DTYPE_MAP.get(f.datatype, np.float32)
                field_info[f.name] = (f.offset, dt)

            # Reshape raw data into per-point rows
            raw = np.frombuffer(data, dtype=np.uint8)
            actual_points = len(raw) // point_step
            if actual_points < num_points:
                num_points = actual_points
            if num_points == 0:
                return None
            raw = raw[:num_points * point_step].reshape(num_points, point_step)

            # Extract XYZ positions
            positions = np.zeros((num_points, 3), dtype=np.float32)
            for i, axis in enumerate(['x', 'y', 'z']):
                if axis in field_info:
                    offset, dtype = field_info[axis]
                    size = np.dtype(dtype).itemsize
                    col = raw[:, offset:offset + size].copy().view(dtype).flatten()
                    positions[:, i] = col.astype(np.float32)

            # Filter out NaN/inf points
            valid_mask = np.isfinite(positions).all(axis=1)
            positions = positions[valid_mask]
            num_points = len(positions)
            if num_points == 0:
                return None

            # Extract colors
            colors = None
            if 'rgb' in field_info or 'rgba' in field_info:
                # Packed RGB/RGBA: 4 bytes holding [b, g, r, (a)] read as uint32
                rgb_name = 'rgba' if 'rgba' in field_info else 'rgb'
                offset, _ = field_info[rgb_name]
                rgb_raw = raw[valid_mask][:, offset:offset + 4].copy().view(np.uint32).flatten()
                r = ((rgb_raw >> 16) & 0xFF).astype(np.uint8)
                g = ((rgb_raw >> 8) & 0xFF).astype(np.uint8)
                b = (rgb_raw & 0xFF).astype(np.uint8)
                colors = np.column_stack([r, g, b])
            elif 'r' in field_info and 'g' in field_info and 'b' in field_info:
                # Separate r, g, b fields
                colors = np.zeros((num_points, 3), dtype=np.uint8)
                for ci, ch in enumerate(['r', 'g', 'b']):
                    offset, dtype = field_info[ch]
                    size = np.dtype(dtype).itemsize
                    colors[:, ci] = raw[valid_mask][:, offset:offset + size].copy().view(dtype).flatten().astype(np.uint8)
            elif 'intensity' in field_info:
                # Map intensity to a colormap
                offset, dtype = field_info['intensity']
                size = np.dtype(dtype).itemsize
                intensity = raw[valid_mask][:, offset:offset + size].copy().view(dtype).flatten().astype(np.float32)
                valid_i = intensity[np.isfinite(intensity)]
                if valid_i.size > 0:
                    i_min, i_max = float(valid_i.min()), float(valid_i.max())
                    if i_max > i_min:
                        norm = np.clip((intensity - i_min) / (i_max - i_min) * 255, 0, 255).astype(np.uint8)
                    else:
                        norm = np.full(num_points, 128, dtype=np.uint8)
                else:
                    norm = np.full(num_points, 128, dtype=np.uint8)
                try:
                    import cv2
                    colored = cv2.applyColorMap(norm.reshape(-1, 1), cv2.COLORMAP_TURBO).reshape(-1, 3)
                    colors = colored[:, ::-1].copy()  # BGR -> RGB
                except ImportError:
                    colors = np.column_stack([norm, 255 - norm, np.full(num_points, 128, dtype=np.uint8)])

            if colors is None:
                # Height-based coloring (z-axis)
                z = positions[:, 2]
                z_min, z_max = float(z.min()), float(z.max())
                if z_max > z_min:
                    z_norm = np.clip((z - z_min) / (z_max - z_min) * 255, 0, 255).astype(np.uint8)
                else:
                    z_norm = np.full(num_points, 128, dtype=np.uint8)
                try:
                    import cv2
                    colored = cv2.applyColorMap(z_norm.reshape(-1, 1), cv2.COLORMAP_TURBO).reshape(-1, 3)
                    colors = colored[:, ::-1].copy()  # BGR -> RGB
                except ImportError:
                    colors = np.column_stack([z_norm, 255 - z_norm, np.full(num_points, 128, dtype=np.uint8)])

            # Downsample if too many points
            if num_points > max_points:
                indices = np.random.choice(num_points, max_points, replace=False)
                positions = positions[indices]
                colors = colors[indices]
                num_points = max_points

            # Compute bounds for camera setup
            bounds_min = positions.min(axis=0).tolist()
            bounds_max = positions.max(axis=0).tolist()

            return {
                'positions': base64.b64encode(positions.astype(np.float32).tobytes()).decode('utf-8'),
                'colors': base64.b64encode(colors.astype(np.uint8).tobytes()).decode('utf-8'),
                'num_points': int(num_points),
                'bounds': {'min': bounds_min, 'max': bounds_max},
            }
        except Exception as e:
            self.get_logger().warn(f'PointCloud2 data extraction failed: {e}')
            return None

    def _raw_image_to_dict(self, msg):
        """Convert a raw sensor_msgs/Image to dict with base64 encoded JPEG"""
        try:
            import numpy as np
            
            encoding = msg.encoding
            enc_map = {
                'rgb8': (np.uint8, 3), 'bgr8': (np.uint8, 3),
                'rgba8': (np.uint8, 4), 'bgra8': (np.uint8, 4),
                'mono8': (np.uint8, 1), '8UC1': (np.uint8, 1),
                'mono16': (np.uint16, 1), '16UC1': (np.uint16, 1),
                '32FC1': (np.float32, 1), '32FC3': (np.float32, 3),
            }
            
            if encoding not in enc_map:
                return {
                    '_msg_type': 'image_metadata',
                    'encoding': encoding,
                    'width': msg.width, 'height': msg.height,
                    'step': msg.step,
                    'error': f'Unsupported encoding: {encoding}'
                }
            
            dtype, channels = enc_map[encoding]
            arr = np.frombuffer(bytes(msg.data), dtype=dtype)
            if channels == 1:
                arr = arr.reshape((msg.height, msg.width))
            else:
                arr = arr.reshape((msg.height, msg.width, channels))
            
            # Normalize float images to 8-bit for display
            if dtype == np.float32:
                valid = arr[np.isfinite(arr)]
                if valid.size > 0:
                    min_val, max_val = float(valid.min()), float(valid.max())
                    if max_val > min_val:
                        arr = np.clip((arr - min_val) / (max_val - min_val) * 255, 0, 255).astype(np.uint8)
                    else:
                        arr = np.zeros((msg.height, msg.width) if channels == 1 else (msg.height, msg.width, channels), dtype=np.uint8)
                else:
                    arr = np.zeros((msg.height, msg.width) if channels == 1 else (msg.height, msg.width, channels), dtype=np.uint8)
            # Convert 16-bit to 8-bit for display
            elif dtype == np.uint16:
                arr = (arr / 256).astype(np.uint8)
            
            # Encode to JPEG using cv2 (commonly available in ROS2)
            try:
                import cv2
                if encoding == 'rgb8':
                    arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
                elif encoding == 'rgba8':
                    arr = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
                elif encoding == 'bgra8':
                    arr = cv2.cvtColor(arr, cv2.COLOR_BGRA2BGR)
                # Apply colormap for single-channel depth/mono for better visualization
                if len(arr.shape) == 2 and encoding in ('32FC1', 'mono16', '16UC1'):
                    arr = cv2.applyColorMap(arr, cv2.COLORMAP_JET)
                _, encoded = cv2.imencode('.jpg', arr, [cv2.IMWRITE_JPEG_QUALITY, 80])
                img_bytes = encoded.tobytes()
            except ImportError:
                # cv2 not available, try manual encoding
                import struct
                # Minimal BMP encoding as last resort (no PIL, no cv2)
                if len(arr.shape) == 2:
                    arr = np.stack([arr, arr, arr], axis=-1)
                h, w, c = arr.shape
                row_size = (w * 3 + 3) & ~3
                pixel_size = row_size * h
                header_size = 54
                bmp = bytearray(header_size + pixel_size)
                # BMP header
                struct.pack_into('<2sIHHI', bmp, 0, b'BM', header_size + pixel_size, 0, 0, header_size)
                struct.pack_into('<IIIHHIIIIII', bmp, 14, 40, w, h, 1, 24, 0, pixel_size, 0, 0, 0, 0)
                # Pixel data BGR bottom-up
                for y in range(h):
                    src_row = arr[h - 1 - y]
                    row_start = header_size + y * row_size
                    for x in range(w):
                        bmp[row_start + x*3]     = src_row[x][2] if c == 3 else src_row[x][0]
                        bmp[row_start + x*3 + 1] = src_row[x][1] if c == 3 else src_row[x][0]
                        bmp[row_start + x*3 + 2] = src_row[x][0]
                img_bytes = bytes(bmp)
                return {
                    '_msg_type': 'compressed_image',
                    'format': 'bmp',
                    'data': base64.b64encode(img_bytes).decode('utf-8'),
                    'width': msg.width,
                    'height': msg.height,
                    'encoding': encoding,
                    'header': self._message_to_dict(msg.header) if hasattr(msg, 'header') else {},
                    'note': 'cv2 not available, using BMP fallback (lower quality)'
                }
            
            return {
                '_msg_type': 'compressed_image',
                'format': 'jpeg',
                'data': base64.b64encode(img_bytes).decode('utf-8'),
                'width': msg.width,
                'height': msg.height,
                'encoding': encoding,
                'header': self._message_to_dict(msg.header) if hasattr(msg, 'header') else {}
            }
        except Exception as e:
            return {
                '_msg_type': 'image_metadata',
                'encoding': msg.encoding,
                'width': msg.width, 'height': msg.height,
                'error': str(e)
            }

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

    def _qos_to_dict(self, qos_profile):
        """Convert a QoS profile to a compact serialisable dict"""
        try:
            return {
                'reliability': qos_profile.reliability.name,
                'durability': qos_profile.durability.name,
                'history': qos_profile.history.name,
                'depth': qos_profile.depth,
            }
        except Exception:
            return None

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
                                publishers.append({
                                    'name': topic_name,
                                    'qos': self._qos_to_dict(pub.qos_profile),
                                })
                        
                        subs = self.get_subscriptions_info_by_topic(topic_name)
                        for sub in subs:
                            sub_full_name = f"{sub.node_namespace}{sub.node_name}".replace('//', '/')
                            if sub_full_name == node_name:
                                subscribers.append({
                                    'name': topic_name,
                                    'qos': self._qos_to_dict(sub.qos_profile),
                                })
                    
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
                        {
                            'name': f"{pub.node_namespace}{pub.node_name}".replace('//', '/'),
                            'qos': self._qos_to_dict(pub.qos_profile),
                        }
                        for pub in publishers
                    ]
                    
                    sub_nodes = [
                        {
                            'name': f"{sub.node_namespace}{sub.node_name}".replace('//', '/'),
                            'qos': self._qos_to_dict(sub.qos_profile),
                        }
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


# Flask app - will be configured with static folder in main() if needed
app = Flask(__name__)
CORS(app)
sock = Sock(app)

# Global ROS2 node and WebSocket clients
ros2_node = None
ros2_thread = None
ws_clients = []
graph_update_thread = None
last_graph_data = None
shutdown_event = threading.Event()  # Signals all background threads to stop


def graph_update_loop():
  """Background thread to push updates to all connected WebSocket clients"""
  global last_graph_data
  
  while not shutdown_event.is_set():
    try:
      if ros2_node is None or not rclpy.ok():
        shutdown_event.wait(1)
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
      
      shutdown_event.wait(0.5)
    except Exception:
      shutdown_event.wait(1)


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
    
    # Detect image transport topics and warn about potential upstream issues
    image_transport_suffix = None
    transport_suffixes = ['/compressed', '/compressedDepth', '/theora']
    for suffix in transport_suffixes:
      if topic_name.endswith(suffix):
        image_transport_suffix = suffix.lstrip('/')
        break
    
    # Subscribe to the topic
    if not ros2_node.subscribe_to_topic(topic_name, topic_type):
      ws.send(json.dumps({'error': f'Failed to subscribe to topic {topic_name}. Check backend logs for details.'}))
      return
    
    # Send subscription info to client
    info_msg = f'Subscribed to {topic_name} ({topic_type})'
    if image_transport_suffix:
      info_msg += (
        f'. Note: This is an image_transport "{image_transport_suffix}" topic. '
        f'If the raw image publisher is not active, the transport plugin may fail to produce data.'
      )
    ws.send(json.dumps({
      'type': 'info',
      'topic': topic_name,
      'message_type': topic_type,
      'message': info_msg
    }))
    
    # Start receive thread
    receive_thread = threading.Thread(target=receive_messages, daemon=True)
    receive_thread.start()
    
    # Stream messages with timeout warning
    last_timestamp = 0
    subscribe_time = time.time()
    no_message_warned = False
    
    while not stop_streaming.is_set() and not shutdown_event.is_set():
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
          no_message_warned = False
        except Exception:
          break
      elif not no_message_warned and last_timestamp == 0 and time.time() - subscribe_time > 5.0:
        # No messages after 5s - warn client with context-specific message
        warn_msg = f'No messages received on {topic_name} after 5 seconds.'
        if image_transport_suffix:
          warn_msg += (
            f' This is an image_transport "{image_transport_suffix}" topic. '
            f'The upstream publisher may not be producing {image_transport_suffix} data '
            f'(e.g. format incompatibility on the publisher side). '
            f'Check the publishing node\'s console for errors.'
          )
        else:
          warn_msg += (
            ' Possible causes: no active publishers, topic not being published, '
            'or QoS incompatibility. Check backend terminal for QoS warnings.'
          )
        try:
          ws.send(json.dumps({
            'type': 'warning',
            'message': warn_msg
          }))
        except Exception:
          break
        no_message_warned = True
      
      time.sleep(0.05)  # 20Hz update rate
      
  except Exception as e:
    try:
      ws.send(json.dumps({'error': f'{type(e).__name__}: {str(e)}'}))
    except Exception:
      pass
  finally:
    stop_streaming.set()
    # Unsubscribe when connection closes
    if ros2_node:
      ros2_node.unsubscribe_from_topic(topic_name)


def ros2_spin():
    """Spin ROS2 node in separate thread"""
    while not shutdown_event.is_set() and rclpy.ok():
        try:
            rclpy.spin_once(ros2_node, timeout_sec=0.5)
        except Exception:
            if shutdown_event.is_set():
                break


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


@app.route('/api/reset', methods=['POST'])
def reset_graph_state():
    """Reset backend transient cache/state and return health response."""
    global last_graph_data
    try:
        if ros2_node is None:
            return jsonify({'error': 'ROS2 node not initialized'}), 500

        ros2_node.reset_runtime_state()
        last_graph_data = None
        return jsonify({'status': 'ok', 'reset': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'ros2_initialized': ros2_node is not None})


# Static file serving for frontend (only active if --static-dir is provided)
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """Serve frontend files or fall back to index.html for SPA routing"""
    static_dir = app.config.get('STATIC_DIR')
    if static_dir is None:
        return jsonify({'error': 'Static file serving not configured'}), 404
    
    # Check if the requested file exists
    if path and os.path.exists(os.path.join(static_dir, path)):
        return send_from_directory(static_dir, path)
    # Otherwise serve index.html for SPA routing
    return send_from_directory(static_dir, 'index.html')


def main():
    global ros2_node, ros2_thread
    global graph_update_thread
    
    parser = argparse.ArgumentParser(description="ROS2 Graph Backend Server")
    parser.add_argument("--port", type=int, default=5000, help="Port to bind the Flask server (default: 5000)")
    parser.add_argument(
        "--access-log",
        action="store_true",
        help="Enable HTTP access logs from Flask/Werkzeug (disabled by default to reduce polling noise)",
    )
    parser.add_argument(
        "--static-dir",
        type=str,
        default=None,
        help="Path to frontend static files directory (if specified, serves frontend from Flask)",
    )
    args = parser.parse_args()

    configure_access_logging(args.access_log)
    
    def cleanup():
        """Cleanup function to properly shutdown ROS2 and Flask"""
        print("\nShutting down ROS2 Graph Service...")
        # Signal all background threads to stop first
        shutdown_event.set()
        # Give threads a moment to notice the shutdown event
        time.sleep(0.3)
        try:
            if ros2_node is not None:
                ros2_node.reset_runtime_state()
                ros2_node.destroy_node()
            if rclpy.ok():
                rclpy.shutdown()
        except Exception as e:
            print(f"Error during cleanup: {e}")
        print("Shutdown complete.")
        os._exit(0)
    
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
    
    # Configure static file serving if --static-dir provided
    if args.static_dir:
        static_dir = os.path.abspath(args.static_dir)
        if os.path.isdir(static_dir):
            app.config['STATIC_DIR'] = static_dir
            print(f"Frontend static files will be served from: {static_dir}")
        else:
            print(f"Warning: Static directory not found: {static_dir}")
            print("Frontend will not be served from this backend")
    
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
