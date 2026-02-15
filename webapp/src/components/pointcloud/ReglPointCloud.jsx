import { useRef, useEffect, useCallback } from 'react';
import createREGL from 'regl';

/* ---- Minimal mat4 helpers (column-major, OpenGL convention) ---- */
function perspective(fovy, aspect, near, far) {
  const out = new Float32Array(16);
  const f = 1.0 / Math.tan(fovy * 0.5);
  const nf = 1.0 / (near - far);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function lookAt(eye, center, up) {
  const out = new Float32Array(16);
  let z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
  let len = 1.0 / (Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2) || 1);
  z0 *= len; z1 *= len; z2 *= len;
  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
  if (len) { len = 1.0 / len; x0 *= len; x1 *= len; x2 *= len; }
  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;
  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
  return out;
}

/* ---- GLSL Shaders ---- */
const VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 color;
uniform mat4 projection;
uniform mat4 view;
uniform float pointSize;
varying vec3 vColor;
void main() {
  vColor = color / 255.0;
  gl_Position = projection * view * vec4(position, 1.0);
  gl_PointSize = pointSize / gl_Position.w;
}`;

const FRAG = `
precision highp float;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(vColor, 1.0);
}`;

const ReglPointCloud = ({ positions, colors, numPoints, bounds }) => {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);

  // Orbit camera state (spherical coordinates)
  const cameraRef = useRef({
    theta: Math.PI / 4,   // azimuth
    phi: Math.PI / 6,     // elevation
    distance: 3,
    target: [0, 0, 0],
  });

  const getEye = useCallback(() => {
    const { theta, phi, distance, target } = cameraRef.current;
    const cosPhi = Math.cos(phi);
    return [
      target[0] + distance * cosPhi * Math.cos(theta),
      target[1] + distance * Math.sin(phi),
      target[2] + distance * cosPhi * Math.sin(theta),
    ];
  }, []);

  // Initialize regl
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const regl = createREGL({ canvas, extensions: [], attributes: { antialias: true } });
    stateRef.current = { regl, drawCmd: null, posBuffer: null, colBuffer: null };

    // Animation loop
    const frame = regl.frame(() => {
      const state = stateRef.current;
      if (!state?.drawCmd) {
        regl.clear({ color: [0.1, 0.1, 0.18, 1], depth: 1 });
        return;
      }
      regl.clear({ color: [0.1, 0.1, 0.18, 1], depth: 1 });
      const eye = getEye();
      const { target } = cameraRef.current;
      const aspect = canvas.width / canvas.height || 1;
      const cam = cameraRef.current;
      state.drawCmd({
        view: lookAt(eye, target, [0, 1, 0]),
        projection: perspective(Math.PI / 3, aspect, cam.distance * 0.001, cam.distance * 100),
        pointSize: Math.max(1, 40 / cam.distance),
      });
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      const parent = canvas.parentElement;
      if (parent) {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (w > 0 && h > 0) {
          canvas.width = w * window.devicePixelRatio;
          canvas.height = h * window.devicePixelRatio;
          canvas.style.width = w + 'px';
          canvas.style.height = h + 'px';
          regl.poll();
        }
      }
    });
    ro.observe(canvas.parentElement);

    // Mouse handlers for orbit camera
    let dragging = false, lastX = 0, lastY = 0, button = -1;

    const onMouseDown = (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      button = e.button;
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const cam = cameraRef.current;

      if (button === 0) {
        // Left: rotate
        cam.theta -= dx * 0.005;
        cam.phi = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, cam.phi + dy * 0.005));
      } else if (button === 2 || button === 1) {
        // Right / middle: pan
        const speed = cam.distance * 0.002;
        const cosT = Math.cos(cam.theta), sinT = Math.sin(cam.theta);
        // Pan in camera-local XY
        cam.target[0] += (-dx * cosT + 0) * speed;
        cam.target[2] += (-dx * (-sinT) + 0) * speed;
        cam.target[1] += dy * speed;
      }
    };
    const onMouseUp = () => { dragging = false; };
    const onWheel = (e) => {
      e.preventDefault();
      const cam = cameraRef.current;
      cam.distance *= e.deltaY > 0 ? 1.1 : 0.9;
      cam.distance = Math.max(0.01, cam.distance);
    };
    const onContextMenu = (e) => e.preventDefault();

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      frame.cancel();
      ro.disconnect();
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      // Destroy buffers
      if (stateRef.current?.posBuffer) stateRef.current.posBuffer.destroy();
      if (stateRef.current?.colBuffer) stateRef.current.colBuffer.destroy();
      regl.destroy();
      stateRef.current = null;
    };
  }, [getEye]);

  // Update point data
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !state.regl || !positions || numPoints === 0) return;

    const regl = state.regl;

    // Destroy old buffers
    if (state.posBuffer) { state.posBuffer.destroy(); state.posBuffer = null; }
    if (state.colBuffer) { state.colBuffer.destroy(); state.colBuffer = null; }

    state.posBuffer = regl.buffer({ data: positions, type: 'float', usage: 'static' });
    state.colBuffer = regl.buffer({
      data: colors && colors.length >= numPoints * 3 ? colors : new Uint8Array(numPoints * 3).fill(128),
      type: 'uint8',
      usage: 'static',
    });

    state.drawCmd = regl({
      vert: VERT,
      frag: FRAG,
      attributes: {
        position: { buffer: state.posBuffer, size: 3 },
        color: { buffer: state.colBuffer, size: 3 },
      },
      uniforms: {
        projection: regl.prop('projection'),
        view: regl.prop('view'),
        pointSize: regl.prop('pointSize'),
      },
      count: numPoints,
      primitive: 'points',
      depth: { enable: true },
    });

    // Fit camera to bounds
    if (bounds) {
      const cam = cameraRef.current;
      cam.target = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ];
      const dx = bounds.max[0] - bounds.min[0];
      const dy = bounds.max[1] - bounds.min[1];
      const dz = bounds.max[2] - bounds.min[2];
      cam.distance = Math.max(dx, dy, dz, 0.1) * 1.5;
    }
  }, [positions, colors, numPoints, bounds]);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 0, position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default ReglPointCloud;
