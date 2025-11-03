import React from 'react';
import './Toolbar.css';

const Toolbar = ({
  onRefresh,
  onToggleAutoRefresh,
  onToggleDebugNodes,
  onToggleDarkMode,
  onResetLayout,
  autoRefresh,
  hideDebugNodes,
  darkMode,
  loading,
  wsConnected,
}) => {
  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <h1 className="toolbar-title">ROS2 Graph Viewer</h1>
      </div>
      
      <div className="toolbar-section toolbar-controls">
        <button
          className="toolbar-button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh graph"
        >
          {loading ? '⏳' : '🔄'} Refresh
        </button>
        
        <button
          className={`toolbar-button ${autoRefresh ? 'active' : ''}`}
          onClick={onToggleAutoRefresh}
          title="Toggle auto-refresh (every 2s, uses polling if WebSocket unavailable)"
        >
          {autoRefresh ? '⏸️' : '▶️'} Auto-Refresh
        </button>
        
        <button
          className={`toolbar-button ${hideDebugNodes ? 'active' : ''}`}
          onClick={onToggleDebugNodes}
          title={hideDebugNodes ? "Debug nodes hidden - click to show" : "Debug nodes visible - click to hide"}
        >
          {hideDebugNodes ? '👁️‍🗨️' : '👁️'} {hideDebugNodes ? 'Hidden' : 'Show All'}
        </button>

        <button
          className={`toolbar-button ${darkMode ? 'active' : ''}`}
          onClick={onToggleDarkMode}
          title="Toggle dark mode"
        >
          {darkMode ? '☀️' : '🌙'} Theme
        </button>

        <button
          className="toolbar-button"
          onClick={onResetLayout}
          title="Reset node positions to automatic layout"
        >
          🔄 Reset Layout
        </button>
      </div>

      <div className="toolbar-section toolbar-info">
        <span className={`status-indicator ${wsConnected ? 'ws-connected' : 'ws-disconnected'}`}>
          {wsConnected ? '🔗' : '📡'} {wsConnected ? 'Live' : 'Polling'}
        </span>
        <span className="status-indicator">
          {loading ? (
            <span className="status-loading">Loading...</span>
          ) : (
            <span className="status-ready">Ready</span>
          )}
        </span>
      </div>
    </div>
  );
};

export default Toolbar;
