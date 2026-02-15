import { useMemo, lazy, Suspense } from 'react';
import './PointCloudViewer.css';

// Lazy-load renderers to reduce initial bundle size (~1MB+ savings)
const ThreePointCloud = lazy(() => import('./pointcloud/ThreePointCloud'));
const ReglPointCloud = lazy(() => import('./pointcloud/ReglPointCloud'));
const DeckGLPointCloud = lazy(() => import('./pointcloud/DeckGLPointCloud'));

const RENDERERS = {
  threejs: ThreePointCloud,
  regl: ReglPointCloud,
  deckgl: DeckGLPointCloud,
};

const RENDERER_LABELS = {
  threejs: 'Three.js',
  regl: 'regl',
  deckgl: 'deck.gl',
};

/** Decode base64 binary → typed arrays */
function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

const PointCloudViewer = ({ renderer = 'threejs', data }) => {
  // Decode base64 point data into typed arrays
  const decoded = useMemo(() => {
    if (!data?.positions || !data?.num_points) {
      return { positions: null, colors: null, numPoints: 0, bounds: null };
    }
    const posBuf = base64ToBuffer(data.positions);
    const colBuf = base64ToBuffer(data.colors);
    return {
      positions: new Float32Array(posBuf),
      colors: new Uint8Array(colBuf),
      numPoints: data.num_points,
      bounds: data.bounds,
    };
  }, [data?.positions, data?.colors, data?.num_points]);

  const Renderer = RENDERERS[renderer] || ThreePointCloud;

  if (!decoded.positions || decoded.numPoints === 0) {
    return (
      <div className="pointcloud-viewer pointcloud-no-data">
        <span>No 3D point data in this message</span>
      </div>
    );
  }

  return (
    <div className="pointcloud-viewer">
      <div className="pointcloud-stats">
        ☁️ {decoded.numPoints.toLocaleString()} pts · {RENDERER_LABELS[renderer] || renderer}
        {decoded.bounds && (
          <span className="pointcloud-bounds">
            {' '}· [{decoded.bounds.min.map(v => v.toFixed(1)).join(', ')}] → [{decoded.bounds.max.map(v => v.toFixed(1)).join(', ')}]
          </span>
        )}
      </div>
      <div className="pointcloud-canvas-container">
        <Suspense fallback={<div className="pointcloud-loading">Loading renderer…</div>}>
          <Renderer
            positions={decoded.positions}
            colors={decoded.colors}
            numPoints={decoded.numPoints}
            bounds={decoded.bounds}
          />
        </Suspense>
      </div>
    </div>
  );
};

export default PointCloudViewer;
