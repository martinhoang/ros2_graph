import React from 'react';
import SearchableDropdown from './widgets/SearchableDropdown';
import './Toolbar.css';

/**
 * Built-in widget renderers for the extensible toolbar.
 * To add a new widget type, add a renderer here and pass the config in the `widgets` prop.
 *
 * Widget config shape:
 *   { id, type: 'dropdown', label, value, onChange, options: [{value, label, description?}], searchable? }
 *   (future: 'toggle' | 'slider' | 'input' | …)
 */
const WIDGET_RENDERERS = {
  dropdown: (w, darkMode) => (
    <SearchableDropdown
      key={w.id}
      value={w.value}
      onChange={w.onChange}
      options={w.options}
      label={w.label}
      placeholder={w.placeholder}
      darkMode={darkMode}
    />
  ),
  // Future widget types can be added here, e.g.:
  // toggle: (w, darkMode) => <ToolbarToggle key={w.id} ... />,
  // slider: (w, darkMode) => <ToolbarSlider key={w.id} ... />,
};

const Toolbar = ({
  onRefresh,
  onToggleAutoRefresh,
  onToggleDebugNodes,
  onToggleDarkMode,
  onToggleGrid,
  onResetLayout,
  onFitView,
  autoRefresh,
  hideDebugNodes,
  darkMode,
  showGrid,
  loading,
  wsConnected,
  widgets,
}) => {
  return (
    <div className={`toolbar ${darkMode ? 'dark-mode' : ''}`}>
      <div className="toolbar-section">
        <h1 className="toolbar-title">ROS2 Graph Viewer</h1>
      </div>
      
      <div className="toolbar-section toolbar-controls">
        <button
          className="toolbar-button"
          onClick={onResetLayout}
          title="Clear graph/cache and re-discover nodes/topics from backend"
        >
          ♻️ Reset
        </button>

        <button
          className="toolbar-button"
          onClick={onRefresh}
          disabled={loading}
          title="Re-apply default layout (no backend re-discovery)"
        >
          {loading ? '⏳' : '🔄'} Refresh
        </button>
        
        <button
          className={`toolbar-button ${autoRefresh ? 'active' : ''}`}
          onClick={onToggleAutoRefresh}
          title="Toggle auto-refresh (polling fallback if WebSocket unavailable)"
        >
          {autoRefresh ? '⏸️' : '▶️'} Auto
        </button>
        
        <button
          className={`toolbar-button ${hideDebugNodes ? 'active' : ''}`}
          onClick={onToggleDebugNodes}
          title={hideDebugNodes ? "Debug nodes hidden - click to show" : "Debug nodes visible - click to hide"}
        >
          {hideDebugNodes ? '👁️‍🗨️' : '👁️'} Debug
        </button>

        <button
          className={`toolbar-button ${darkMode ? 'active' : ''}`}
          onClick={onToggleDarkMode}
          title="Toggle dark mode"
        >
          {darkMode ? '☀️' : '🌙'} Theme
        </button>

        <button
          className={`toolbar-button ${showGrid ? 'active' : ''}`}
          onClick={onToggleGrid}
          title={showGrid ? 'Hide background grid' : 'Show background grid'}
        >
          {showGrid ? '🟦' : '⬜'} Grid
        </button>

        <button
          className="toolbar-button"
          onClick={onFitView}
          title="Fit all nodes in view"
        >
          🔍 Fit
        </button>
      </div>

      {/* Extensible widgets section */}
      {widgets && widgets.length > 0 && (
        <div className="toolbar-section toolbar-widgets">
          {widgets.map((w) => {
            const render = WIDGET_RENDERERS[w.type];
            return render ? render(w, darkMode) : null;
          })}
        </div>
      )}

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
