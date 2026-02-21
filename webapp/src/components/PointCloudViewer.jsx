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
  // Decode base64 point data into typed arrays, applying ROS2→Three.js
  // coordinate transform:
  //   ROS X (forward) → Three -Z  (depth into scene)
  //   ROS Y (left)    → Three -X  (right-hand rule)
  //   ROS Z (up)      → Three +Y  (up)
  const decoded = useMemo(() => {
    if (!data?.positions || !data?.num_points) {
      return { positions: null, colors: null, numPoints: 0, bounds: null };
    }
    
    const isOptical = data.header?.frame_id?.includes('optical');
    
    const raw = new Float32Array(base64ToBuffer(data.positions));
    const n = data.num_points;
    const positions = new Float32Array(n * 3);
    
    for (let i = 0; i < n; i++) {
      if (isOptical) {
        // Optical frame: Z forward, X right, Y down
        // Three.js: Z backward, X right, Y up
        positions[i * 3]     =  raw[i * 3];     // Three X =  ROS X
        positions[i * 3 + 1] = -raw[i * 3 + 1]; // Three Y = -ROS Y
        positions[i * 3 + 2] = -raw[i * 3 + 2]; // Three Z = -ROS Z
      } else {
        // Standard ROS frame: X forward, Y left, Z up
        // Three.js: Z backward, X right, Y up
        positions[i * 3]     = -raw[i * 3 + 1]; // Three X = -ROS Y
        positions[i * 3 + 1] =  raw[i * 3 + 2]; // Three Y =  ROS Z
        positions[i * 3 + 2] = -raw[i * 3];     // Three Z = -ROS X
      }
    }
    
    // Transform bounds into the same space
    let bounds = null;
    if (data.bounds) {
      const { min: mn, max: mx } = data.bounds;
      if (isOptical) {
        bounds = {
          min: [ mn[0], -mx[1], -mx[2] ],
          max: [ mx[0], -mn[1], -mn[2] ],
        };
      } else {
        bounds = {
          min: [ -mx[1], mn[2], -mx[0] ],
          max: [ -mn[1], mx[2], -mn[0] ],
        };
      }
    }
    return {
      positions,
      colors: new Uint8Array(base64ToBuffer(data.colors)),
      numPoints: n,
      bounds,
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
