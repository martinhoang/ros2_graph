import React, { useEffect, useState, useRef } from 'react';
import TopicMessageClient from '../api/topicMessageClient';
import './InfoPanel.css';

const InfoPanel = ({ nodeInfo, onClose }) => {
  const [latestMessage, setLatestMessage] = useState(null);
  const [messageError, setMessageError] = useState(null);
  const wsClientRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    // Only subscribe to topic messages if this is a topic
    if (nodeInfo && nodeInfo.type === 'topicNode' && nodeInfo.name) {
      // Cleanup previous connection
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
      }

      // Create new WebSocket connection for this topic
      wsClientRef.current = new TopicMessageClient(
        nodeInfo.name,
        (data) => {
          setLatestMessage(data);
          setMessageError(null);
        },
        (error) => {
          setMessageError(error);
        }
      );

      wsClientRef.current.connect();
    }

    // Cleanup on unmount or when nodeInfo changes
    return () => {
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
    };
  }, [nodeInfo?.name, nodeInfo?.type]);

  // Auto-scroll to bottom when new message arrives
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [latestMessage]);

  if (!nodeInfo) return null;

  const isNode = nodeInfo.type === 'ros2Node';
  const isTopic = nodeInfo.type === 'topicNode';

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <h3>{isNode ? '📦 Node' : '📡 Topic'} Information</h3>
        <button className="close-button" onClick={onClose} title="Close">✕</button>
      </div>
      
      <div className="info-panel-content">
        {nodeInfo.loading ? (
          <div className="info-loading">Loading details...</div>
        ) : nodeInfo.error ? (
          <div className="info-error">Error: {nodeInfo.error}</div>
        ) : (
          <>
            <div className="info-section">
              <label>Name:</label>
              <div className="info-value">{nodeInfo.name}</div>
            </div>

            {isNode && (
              <>
                {nodeInfo.namespace && (
                  <div className="info-section">
                    <label>Namespace:</label>
                    <div className="info-value">{nodeInfo.namespace}</div>
                  </div>
                )}
                
                <div className="info-section">
                  <label>Publishers ({nodeInfo.publishers?.length || 0}):</label>
                  <div className="info-list">
                    {nodeInfo.publishers?.length > 0 ? (
                      nodeInfo.publishers.map((topic, idx) => (
                        <div key={idx} className="info-list-item">📡 {topic}</div>
                      ))
                    ) : (
                      <div className="info-empty">No publishers</div>
                    )}
                  </div>
                </div>

                <div className="info-section">
                  <label>Subscribers ({nodeInfo.subscribers?.length || 0}):</label>
                  <div className="info-list">
                    {nodeInfo.subscribers?.length > 0 ? (
                      nodeInfo.subscribers.map((topic, idx) => (
                        <div key={idx} className="info-list-item">📡 {topic}</div>
                      ))
                    ) : (
                      <div className="info-empty">No subscribers</div>
                    )}
                  </div>
                </div>
              </>
            )}

            {isTopic && (
              <>
                <div className="info-section">
                  <label>Message Types:</label>
                  <div className="info-list">
                    {nodeInfo.types?.length > 0 ? (
                      nodeInfo.types.map((type, idx) => (
                        <div key={idx} className="info-list-item">{type}</div>
                      ))
                    ) : (
                      <div className="info-empty">Unknown</div>
                    )}
                  </div>
                </div>

                <div className="info-section">
                  <label>Publishers ({nodeInfo.publishers?.length || 0}):</label>
                  <div className="info-list">
                    {nodeInfo.publishers?.length > 0 ? (
                      nodeInfo.publishers.map((node, idx) => (
                        <div key={idx} className="info-list-item">📦 {node}</div>
                      ))
                    ) : (
                      <div className="info-empty">No publishers</div>
                    )}
                  </div>
                </div>

                <div className="info-section">
                  <label>Subscribers ({nodeInfo.subscribers?.length || 0}):</label>
                  <div className="info-list">
                    {nodeInfo.subscribers?.length > 0 ? (
                      nodeInfo.subscribers.map((node, idx) => (
                        <div key={idx} className="info-list-item">📦 {node}</div>
                      ))
                    ) : (
                      <div className="info-empty">No subscribers</div>
                    )}
                  </div>
                </div>
              </>
            )}

            {isTopic && latestMessage && (
              <div className="info-section message-console-section">
                <label>Latest Message:</label>
                <div className="message-console">
                  <pre className="message-content">
                    {JSON.stringify(latestMessage.data, null, 2)}
                  </pre>
                  <div ref={messagesEndRef} />
                </div>
                <div className="message-timestamp">
                  Last updated: {new Date(latestMessage.timestamp * 1000).toLocaleTimeString()}
                </div>
              </div>
            )}

            {isTopic && messageError && (
              <div className="info-section">
                <label>Message Stream:</label>
                <div className="message-error">Error: {messageError}</div>
              </div>
            )}

            {isTopic && !latestMessage && !messageError && !nodeInfo.loading && (
              <div className="info-section">
                <label>Message Stream:</label>
                <div className="message-waiting">Waiting for messages...</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default InfoPanel;
