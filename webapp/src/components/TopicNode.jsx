import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import './TopicNode.css';

const TopicNodeComponent = memo(({ data, isConnectable }) => {
  const getTopicColor = () => {
    if (data.messageType?.includes('sensor_msgs')) return '#48bb78';
    if (data.messageType?.includes('geometry_msgs')) return '#ed8936';
    if (data.messageType?.includes('std_msgs')) return '#4299e1';
    return '#9f7aea';
  };

  return (
    <div 
      className="topic-node" 
      style={{ borderColor: getTopicColor() }}
      onMouseEnter={data.onMouseEnter}
      onMouseLeave={data.onMouseLeave}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="topic-handle"
      />
      <div className="topic-content">
        <div className="topic-icon">📡</div>
        <div className="topic-label">{data.label}</div>
        {data.messageType && (
          <div className="topic-type">{data.messageType}</div>
        )}
        {data.publisherCount !== undefined && data.subscriberCount !== undefined && (
          <div className="topic-stats">
            <span className="pub-count">Pub: {data.publisherCount}</span>
            <span className="sub-count">Sub: {data.subscriberCount}</span>
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        className="topic-handle"
      />
    </div>
  );
});

TopicNodeComponent.displayName = 'TopicNodeComponent';

export default TopicNodeComponent;
