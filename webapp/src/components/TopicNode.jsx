import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import './TopicNode.css';

const TopicNodeComponent = memo(({ data, isConnectable }) => {
  return (
    <div 
      className="topic-node"
      onMouseEnter={data.onMouseEnter}
      onMouseLeave={data.onMouseLeave}
      onClick={data.onClick}
      style={{ cursor: 'pointer' }}
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
