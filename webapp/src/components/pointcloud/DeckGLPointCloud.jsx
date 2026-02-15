import { useRef, useEffect } from 'react';
import { Deck, OrbitView } from '@deck.gl/core';
import { PointCloudLayer } from '@deck.gl/layers';

const DeckGLPointCloud = ({ positions, colors, numPoints, bounds }) => {
  const containerRef = useRef(null);
  const deckRef = useRef(null);

  // Initialize Deck instance
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create a canvas element
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    const deck = new Deck({
      canvas,
      views: new OrbitView({ id: 'orbit', orbitAxis: 'Y' }),
      initialViewState: {
        target: [0, 0, 0],
        zoom: 1,
        rotationX: 30,
        rotationOrbit: -30,
        minZoom: -10,
        maxZoom: 20,
      },
      controller: true,
      layers: [],
      getTooltip: null,
      // Transparent background — we set CSS background
      parameters: { clearColor: [0.1, 0.1, 0.18, 1] },
    });

    deckRef.current = { deck, canvas };

    // Resize observer
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        deck.setProps({ width: w, height: h });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      deck.finalize();
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
      deckRef.current = null;
    };
  }, []);

  // Update layers when data changes
  useEffect(() => {
    if (!deckRef.current || !positions || numPoints === 0) return;

    const { deck } = deckRef.current;

    // Build a typed data object for binary attributes
    const layer = new PointCloudLayer({
      id: 'pointcloud',
      data: { length: numPoints },
      getPosition: { value: positions, size: 3 },
      getColor: {
        value: colors && colors.length >= numPoints * 3
          ? colors
          : new Uint8Array(numPoints * 3).fill(128),
        size: 3,
      },
      getNormal: [0, 0, 1],
      pointSize: 3,
      material: {
        ambient: 0.6,
        diffuse: 0.4,
        shininess: 32,
      },
      coordinateSystem: 0, // CARTESIAN
    });

    // Fit view to bounds
    if (bounds) {
      const target = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ];
      const dx = bounds.max[0] - bounds.min[0];
      const dy = bounds.max[1] - bounds.min[1];
      const dz = bounds.max[2] - bounds.min[2];
      const maxDim = Math.max(dx, dy, dz, 0.1);
      // zoom = log2(512 / worldSize) approximately
      const zoom = Math.log2(2 / maxDim);

      deck.setProps({
        initialViewState: {
          target,
          zoom,
          rotationX: 30,
          rotationOrbit: -30,
          minZoom: zoom - 10,
          maxZoom: zoom + 10,
        },
        layers: [layer],
      });
    } else {
      deck.setProps({ layers: [layer] });
    }
  }, [positions, colors, numPoints, bounds]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        position: 'relative',
        background: '#1a1a2e',
      }}
    />
  );
};

export default DeckGLPointCloud;
