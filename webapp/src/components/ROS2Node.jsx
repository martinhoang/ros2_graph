import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import './ROS2Node.css';

const ROS2NodeComponent = memo(({ data, isConnectable }) => {
  return (
    <div 
      className="ros2-node"
      onMouseEnter={data.onMouseEnter}
      onMouseLeave={data.onMouseLeave}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="node-handle"
      />
      <div className="node-content">
        <div className="node-icon">📦</div>
        <div className="node-label">{data.label}</div>
        {data.namespace && (
          <div className="node-namespace">{data.namespace}</div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        className="node-handle"
      />
    </div>
  );
});

ROS2NodeComponent.displayName = 'ROS2NodeComponent';

export default ROS2NodeComponent;
