import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const ThreePointCloud = ({ positions, colors, numPoints, bounds }) => {
  const containerRef = useRef(null);
  const stateRef = useRef(null);
  const cameraInitializedRef = useRef(false);

  // Setup scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(
      60, container.clientWidth / container.clientHeight, 0.01, 1000
    );
    camera.position.set(2, 2, 2);

    // Request discrete GPU; antialias handled in shader via round-disc discard
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;

    // Axes helper
    scene.add(new THREE.AxesHelper(0.5));

    // Grid helper
    const grid = new THREE.GridHelper(10, 20, 0x444466, 0x333344);
    scene.add(grid);

    stateRef.current = { scene, camera, renderer, controls, container };

    // Animation loop
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      stateRef.current = null;
    };
  }, []);

  // Update point data
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !positions || numPoints === 0) return;

    // Remove old points
    const old = state.scene.getObjectByName('pcPoints');
    if (old) {
      old.geometry.dispose();
      old.material.dispose();
      state.scene.remove(old);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    if (colors && colors.length >= numPoints * 3) {
      // Upload Uint8 directly with normalized=true — GPU divides by 255, no CPU loop needed
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
    }

    const material = new THREE.PointsMaterial({
      size: 0.015,
      vertexColors: true,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'pcPoints';
    state.scene.add(points);

    // Fit camera to bounds only on first load
    if (bounds && !cameraInitializedRef.current) {
      const center = new THREE.Vector3(
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2
      );
      const size = new THREE.Vector3(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2]
      );
      const maxDim = Math.max(size.x, size.y, size.z, 0.1);
      state.camera.position.set(
        center.x + maxDim * 0.8,
        center.y + maxDim * 0.6,
        center.z + maxDim * 0.8
      );
      state.controls.target.copy(center);
      state.camera.near = maxDim * 0.001;
      state.camera.far = maxDim * 100;
      state.camera.updateProjectionMatrix();
      cameraInitializedRef.current = true;
    }
  }, [positions, colors, numPoints, bounds]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 0 }}
    />
  );
};

export default ThreePointCloud;
