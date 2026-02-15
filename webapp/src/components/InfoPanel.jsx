import React, { useEffect, useState, useRef, useCallback } from 'react';
import TopicMessageClient from '../api/topicMessageClient';
import PointCloudViewer from './PointCloudViewer';
import './InfoPanel.css';

const STORAGE_KEY = 'ros2_graph_infopanel_layout';
const MIN_W = 260;
const MIN_H = 200;

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function loadLayout() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch { return null; }
}
function saveLayout(layout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {}
}

/** Dock icon SVGs — tiny inline icons for the header buttons */
const DockIcon = ({ side }) => {
  // 14x14 icons showing which edge the panel docks to
  const bar = { fill: 'currentColor' };
  const box = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };
  switch (side) {
    case 'left':
      return (<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="1" {...box}/><rect x="1" y="1" width="4" height="12" rx="1" {...bar} fillOpacity="0.5"/></svg>);
    case 'right':
      return (<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="1" {...box}/><rect x="9" y="1" width="4" height="12" rx="1" {...bar} fillOpacity="0.5"/></svg>);
    case 'top':
      return (<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="1" {...box}/><rect x="1" y="1" width="12" height="4" rx="1" {...bar} fillOpacity="0.5"/></svg>);
    case 'bottom':
      return (<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="1" {...box}/><rect x="1" y="9" width="12" height="4" rx="1" {...bar} fillOpacity="0.5"/></svg>);
    case 'float':
      return (<svg width="14" height="14" viewBox="0 0 14 14"><rect x="3" y="3" width="9" height="9" rx="1.5" {...box}/><rect x="1" y="1" width="8" height="8" rx="1.5" {...box}/></svg>);
    default: return null;
  }
};

const InfoPanel = ({ nodeInfo, onClose, pcRenderer = 'threejs' }) => {
  // --- topic message state ---
  const [latestMessage, setLatestMessage] = useState(null);
  const [messageError, setMessageError] = useState(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const wsClientRef = useRef(null);
  const consoleRef = useRef(null);

  // --- layout state ---
  const [dock, setDock] = useState('right'); // 'left'|'right'|'top'|'bottom'|'float'
  const [panelSize, setPanelSize] = useState({ w: 380, h: 500 }); // for docked: w (left/right) or h (top/bottom); for float both
  const [floatPos, setFloatPos] = useState({ x: 100, y: 100 });

  // refs for drag / resize handlers
  const panelRef = useRef(null);
  const dragState = useRef(null);
  const resizeState = useRef(null);

  // Load saved layout on mount
  useEffect(() => {
    const saved = loadLayout();
    if (saved) {
      if (saved.dock) setDock(saved.dock);
      if (saved.panelSize) setPanelSize(saved.panelSize);
      if (saved.floatPos) setFloatPos(saved.floatPos);
    }
  }, []);

  // Save layout on change
  useEffect(() => {
    saveLayout({ dock, panelSize, floatPos });
  }, [dock, panelSize, floatPos]);

  // --- WebSocket subscription ---
  useEffect(() => {
    if (nodeInfo && nodeInfo.type === 'topicNode' && nodeInfo.name) {
      // Cleanup previous subscription before creating new one
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
      setLatestMessage(null);
      setMessageError(null);
      setUserScrolled(false);

      wsClientRef.current = new TopicMessageClient(
        nodeInfo.name,
        (data) => { setLatestMessage(data); setMessageError(null); },
        (error) => { setMessageError(error); }
      );
      wsClientRef.current.connect();
    }
    return () => {
      // Cleanup on unmount or when nodeInfo changes
      if (wsClientRef.current) { 
        wsClientRef.current.disconnect(); 
        wsClientRef.current = null; 
      }
    };
  }, [nodeInfo?.name, nodeInfo?.type]);

  // Additional cleanup when panel closes
  useEffect(() => {
    return () => {
      // Ensure cleanup when component unmounts (panel closes)
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
    };
  }, []);

  // Smart auto-scroll
  useEffect(() => {
    if (consoleRef.current && !userScrolled) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [latestMessage, userScrolled]);

  const handleConsoleScroll = useCallback(() => {
    const el = consoleRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setUserScrolled(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (consoleRef.current) {
      setUserScrolled(false);
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, []);

  // --- Drag (header) ---
  const onHeaderMouseDown = useCallback((e) => {
    if (e.target.closest('.panel-header-btn')) return; // don't drag when clicking buttons
    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      startLeft: rect.left, startTop: rect.top,
      wasDocked: dock !== 'float',
      width: rect.width, height: rect.height,
      moved: false,
    };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }, [dock]);

  const onDragMove = useCallback((e) => {
    const ds = dragState.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    ds.moved = true;

    // If was docked, undock and switch to float immediately
    if (ds.wasDocked) {
      ds.wasDocked = false;
      setDock('float');
      // Use the current panel size as the float size
      setPanelSize(prev => ({ w: Math.min(prev.w, ds.width), h: Math.min(prev.h, ds.height) }));
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const newX = clamp(ds.startLeft + dx, 0, vw - ds.width);
    const newY = clamp(ds.startTop + dy, 0, vh - ds.height);
    setFloatPos({ x: newX, y: newY });
  }, []);

  const onDragEnd = useCallback(() => {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    dragState.current = null;
  }, [onDragMove]);

  // --- Resize ---
  const onResizeMouseDown = useCallback((e, handleType) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = panelRef.current.getBoundingClientRect();
    resizeState.current = {
      handleType,
      startX: e.clientX, startY: e.clientY,
      startW: rect.width, startH: rect.height,
      startLeft: rect.left, startTop: rect.top,
    };
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }, []);

  const onResizeMove = useCallback((e) => {
    const rs = resizeState.current;
    if (!rs) return;
    const dx = e.clientX - rs.startX;
    const dy = e.clientY - rs.startY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = Math.floor(vw * 0.5);
    const maxH = vh;
    const ht = rs.handleType;

    if (dock === 'float') {
      let newW = rs.startW, newH = rs.startH;
      let newX = rs.startLeft, newY = rs.startTop;

      if (ht.includes('right'))  newW = clamp(rs.startW + dx, MIN_W, maxW);
      if (ht.includes('left'))   { newW = clamp(rs.startW - dx, MIN_W, maxW); newX = rs.startLeft + (rs.startW - newW); }
      if (ht.includes('bottom')) newH = clamp(rs.startH + dy, MIN_H, maxH);
      if (ht.includes('top'))    { newH = clamp(rs.startH - dy, MIN_H, maxH); newY = rs.startTop + (rs.startH - newH); }

      newX = clamp(newX, 0, vw - newW);
      newY = clamp(newY, 0, vh - newH);

      setPanelSize({ w: newW, h: newH });
      setFloatPos({ x: newX, y: newY });
    } else if (dock === 'left') {
      setPanelSize(prev => ({ ...prev, w: clamp(rs.startW + dx, MIN_W, maxW) }));
    } else if (dock === 'right') {
      setPanelSize(prev => ({ ...prev, w: clamp(rs.startW - dx, MIN_W, maxW) }));
    } else if (dock === 'top') {
      setPanelSize(prev => ({ ...prev, h: clamp(rs.startH + dy, MIN_H, maxH) }));
    } else if (dock === 'bottom') {
      setPanelSize(prev => ({ ...prev, h: clamp(rs.startH - dy, MIN_H, maxH) }));
    }
  }, [dock]);

  const onResizeEnd = useCallback(() => {
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
    resizeState.current = null;
  }, [onResizeMove]);

  // --- Dock buttons ---
  const handleDock = useCallback((side) => {
    if (side === dock) return;
    if (side !== 'float') {
      // When docking, reset size to sensible default for that orientation
      if (side === 'left' || side === 'right') {
        setPanelSize(prev => ({ ...prev, w: Math.max(prev.w, 350) }));
      } else {
        setPanelSize(prev => ({ ...prev, h: Math.max(prev.h, 300) }));
      }
    } else {
      // When undocking, set float position to center-ish
      setFloatPos({ x: Math.max(50, (window.innerWidth - panelSize.w) / 2), y: 80 });
    }
    setDock(side);
  }, [dock, panelSize.w]);

  // --- Compute style ---
  const computeStyle = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = Math.floor(vw * 0.5);
    const maxH = vh;
    const w = clamp(panelSize.w, MIN_W, maxW);
    const h = clamp(panelSize.h, MIN_H, maxH);

    switch (dock) {
      case 'left': return { width: w };
      case 'right': return { width: w };
      case 'top': return { height: h };
      case 'bottom': return { height: h };
      case 'float': return {
        left: clamp(floatPos.x, 0, vw - w),
        top: clamp(floatPos.y, 0, vh - h),
        width: w,
        height: h,
      };
      default: return { width: w };
    }
  };

  // --- Resize handles ---
  const renderResizeHandles = () => {
    if (dock === 'left') {
      return <div className="resize-handle edge-right" onMouseDown={(e) => onResizeMouseDown(e, 'right')} />;
    } else if (dock === 'right') {
      return <div className="resize-handle edge-left" onMouseDown={(e) => onResizeMouseDown(e, 'left')} />;
    } else if (dock === 'top') {
      return <div className="resize-handle edge-bottom" onMouseDown={(e) => onResizeMouseDown(e, 'bottom')} />;
    } else if (dock === 'bottom') {
      return <div className="resize-handle edge-top" onMouseDown={(e) => onResizeMouseDown(e, 'top')} />;
    } else {
      // Float: all 8 handles
      return (
        <>
          <div className="resize-handle edge-left"   onMouseDown={(e) => onResizeMouseDown(e, 'left')} />
          <div className="resize-handle edge-right"  onMouseDown={(e) => onResizeMouseDown(e, 'right')} />
          <div className="resize-handle edge-top"    onMouseDown={(e) => onResizeMouseDown(e, 'top')} />
          <div className="resize-handle edge-bottom" onMouseDown={(e) => onResizeMouseDown(e, 'bottom')} />
          <div className="resize-handle corner-tl"   onMouseDown={(e) => onResizeMouseDown(e, 'top-left')} />
          <div className="resize-handle corner-tr"   onMouseDown={(e) => onResizeMouseDown(e, 'top-right')} />
          <div className="resize-handle corner-bl"   onMouseDown={(e) => onResizeMouseDown(e, 'bottom-left')} />
          <div className="resize-handle corner-br"   onMouseDown={(e) => onResizeMouseDown(e, 'bottom-right')} />
        </>
      );
    }
  };

  if (!nodeInfo) return null;

  const isNode = nodeInfo.type === 'ros2Node';
  const isTopic = nodeInfo.type === 'topicNode';
  const dockClass = dock === 'float' ? 'floating' : `docked-${dock}`;

  return (
    <div
      ref={panelRef}
      className={`info-panel ${dockClass}`}
      style={computeStyle()}
    >
      {renderResizeHandles()}

      {/* Header — drag handle */}
      <div className="info-panel-header" onMouseDown={onHeaderMouseDown}>
        <h3>{isNode ? '📦 Node' : '📡 Topic'} Info</h3>
        <div className="panel-header-actions">
          <button className={`panel-header-btn${dock === 'left' ? ' active' : ''}`} onClick={() => handleDock('left')} title="Dock Left"><DockIcon side="left" /></button>
          <button className={`panel-header-btn${dock === 'right' ? ' active' : ''}`} onClick={() => handleDock('right')} title="Dock Right"><DockIcon side="right" /></button>
          <button className={`panel-header-btn${dock === 'top' ? ' active' : ''}`} onClick={() => handleDock('top')} title="Dock Top"><DockIcon side="top" /></button>
          <button className={`panel-header-btn${dock === 'bottom' ? ' active' : ''}`} onClick={() => handleDock('bottom')} title="Dock Bottom"><DockIcon side="bottom" /></button>
          <button className={`panel-header-btn${dock === 'float' ? ' active' : ''}`} onClick={() => handleDock('float')} title="Undock (Float)"><DockIcon side="float" /></button>
          <button className="panel-header-btn close-btn" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {/* Content */}
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

            {/* Topic live message */}
            {isTopic && latestMessage && (
              <div className="info-section message-console-section">
                <label>Latest Message:</label>
                {latestMessage.data?._msg_type === 'compressed_image' && latestMessage.data?.data ? (
                  <div className="message-image-container">
                    <img
                      src={`data:image/${latestMessage.data.format || 'jpeg'};base64,${latestMessage.data.data}`}
                      alt={nodeInfo.name}
                      className="message-image"
                    />
                    <div className="image-info">
                      {latestMessage.data.width && `${latestMessage.data.width}×${latestMessage.data.height}`}
                      {latestMessage.data.encoding && ` · ${latestMessage.data.encoding}`}
                      {latestMessage.data.format && ` · ${latestMessage.data.format}`}
                    </div>
                  </div>
                ) : latestMessage.data?._msg_type === 'compressed_image' && latestMessage.data?.error ? (
                  <div className="message-image-metadata">
                    <div>🖼️ CompressedImage</div>
                    <div>Format: {latestMessage.data.format || 'unknown'}</div>
                    <div className="image-meta-note">⚠️ {latestMessage.data.error}</div>
                  </div>
                ) : latestMessage.data?._msg_type === 'pointcloud2' ? (
                  <div className="message-console-section pointcloud-section">
                    <PointCloudViewer
                      renderer={pcRenderer}
                      data={latestMessage.data}
                    />
                    <div className="pointcloud-meta">
                      <span>{latestMessage.data.width}×{latestMessage.data.height}</span>
                      <span>step: {latestMessage.data.point_step}B</span>
                      <span>{(latestMessage.data.data_size / 1024).toFixed(0)} KB</span>
                      {latestMessage.data.fields?.map((f, i) => (
                        <span key={i} className="pointcloud-field">{f.name}</span>
                      ))}
                    </div>
                  </div>
                ) : latestMessage.data?._msg_type === 'image_metadata' ? (
                  <div className="message-image-metadata">
                    <div>🖼️ Image: {latestMessage.data.width}×{latestMessage.data.height}</div>
                    <div>Encoding: {latestMessage.data.encoding}</div>
                    {latestMessage.data.error && (
                      <div className="image-meta-note">⚠️ Cannot render: {latestMessage.data.error}</div>
                    )}
                  </div>
                ) : (
                  <div className="message-console-wrapper">
                    <div
                      className="message-console"
                      ref={consoleRef}
                      onScroll={handleConsoleScroll}
                    >
                      <pre className="message-content">
                        {JSON.stringify(latestMessage.data, null, 2)}
                      </pre>
                    </div>
                    {userScrolled && (
                      <button className="scroll-to-bottom-btn" onClick={scrollToBottom} title="Scroll to bottom">
                        ↓ Auto-scroll
                      </button>
                    )}
                  </div>
                )}
                <div className="message-timestamp">
                  Last updated: {new Date(latestMessage.timestamp * 1000).toLocaleTimeString()}
                </div>
              </div>
            )}

            {isTopic && messageError && (
              <div className="info-section">
                <label>Message Stream:</label>
                <div className="message-error">{messageError}</div>
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
