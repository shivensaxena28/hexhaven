// The hex board, rendered as SVG. Supports mouse/touch pan & zoom and
// highlights whatever placements are currently legal for the acting player.

import { useMemo, useRef, useState } from 'react';
import { buildGraph, hexCorners, hexCenter } from '../engine/board.js';
import { PLAYER_COLORS } from '../engine/constants.js';

const RES_COLORS = {
  brick: '#c4653f',
  lumber: '#3e7c4f',
  wool: '#a8c686',
  grain: '#e0b552',
  ore: '#8a8f9c',
  desert: '#ddd0a8',
};
const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

function Token({ hex }) {
  const c = hexCenter(hex.q, hex.r);
  const hot = hex.token === 6 || hex.token === 8;
  return (
    <g className="token">
      <circle cx={c.x} cy={c.y} r={3.1} />
      <text x={c.x} y={c.y + 1.1} fontSize={hot ? 3.6 : 3.1} fill={hot ? '#c0392b' : '#2b2b33'}>
        {hex.token}
      </text>
      <text className="pips" x={c.x} y={c.y + 2.6} fill={hot ? '#c0392b' : '#6d6d78'}>
        {'•'.repeat(PIPS[hex.token] || 0)}
      </text>
    </g>
  );
}

function Robber({ hex }) {
  const c = hexCenter(hex.q, hex.r);
  return (
    <g transform={`translate(${c.x + 3.6} ${c.y - 3.4})`} pointerEvents="none">
      <ellipse cx={0} cy={1.6} rx={1.7} ry={0.7} fill="#23232b" />
      <rect x={-1.1} y={-1.6} width={2.2} height={3.2} rx={1.1} fill="#23232b" />
      <circle cx={0} cy={-2.2} r={1.05} fill="#23232b" />
    </g>
  );
}

function Settlement({ x, y, color }) {
  const p = `${x - 1.5},${y + 1.3} ${x - 1.5},${y - 0.4} ${x},${y - 1.7} ${x + 1.5},${y - 0.4} ${x + 1.5},${y + 1.3}`;
  return <polygon points={p} fill={color} stroke="#2b2b33" strokeWidth={0.28} />;
}

function City({ x, y, color }) {
  const p = [
    `${x - 2},${y + 1.6}`, `${x - 2},${y - 1.4}`, `${x - 1},${y - 2.4}`, `${x},${y - 1.4}`,
    `${x},${y - 0.4}`, `${x + 2},${y - 0.4}`, `${x + 2},${y + 1.6}`,
  ].join(' ');
  return <polygon points={p} fill={color} stroke="#2b2b33" strokeWidth={0.3} />;
}

function Port({ port, graph, hexes }) {
  const v1 = graph.vertices[port.vertices[0]];
  const v2 = graph.vertices[port.vertices[1]];
  const mx = (v1.x + v2.x) / 2;
  const my = (v1.y + v2.y) / 2;
  // Push the chip away from the hex it borders (out to sea).
  const hexId = graph.edges[port.edgeId].hexes[0];
  const hc = hexCenter(hexes[hexId].q, hexes[hexId].r);
  let nx = mx - hc.x;
  let ny = my - hc.y;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  const cx = mx + nx * 3.4;
  const cy = my + ny * 3.4;
  const generic = port.kind === '3:1';
  return (
    <g>
      <line x1={v1.x} y1={v1.y} x2={cx} y2={cy} stroke="#8a6f47" strokeWidth={0.35} strokeDasharray="0.7 0.5" />
      <line x1={v2.x} y1={v2.y} x2={cx} y2={cy} stroke="#8a6f47" strokeWidth={0.35} strokeDasharray="0.7 0.5" />
      <circle cx={cx} cy={cy} r={2.5} fill={generic ? '#f7f1df' : RES_COLORS[port.kind]} stroke="#8a6f47" strokeWidth={0.35} />
      <text className="port-chip" x={cx} y={cy + 1} fill={generic ? '#2b2b33' : '#fff'}>
        {generic ? '3:1' : '2:1'}
      </text>
    </g>
  );
}

export default function Board({
  state,
  highlightVertices = null, // Set of vertex ids, clickable
  highlightEdges = null, // Set of edge ids, clickable
  highlightHexes = null, // Set of hex ids, clickable (robber)
  onVertexClick,
  onEdgeClick,
  onHexClick,
}) {
  const graph = useMemo(() => buildGraph(state.board.hexes), [state.board.hexes]);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const svgRef = useRef(null);

  const bounds = useMemo(() => {
    const vs = Object.values(graph.vertices);
    const xs = vs.map((v) => v.x);
    const ys = vs.map((v) => v.y);
    const pad = 8;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      minX,
      minY,
      w: Math.max(...xs) - minX + pad,
      h: Math.max(...ys) - minY + pad,
    };
  }, [graph]);

  // ---- pan & zoom (pointer events cover mouse and touch) ----
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
  };
  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    const rect = svgRef.current.getBoundingClientRect();
    const unitsPerPx = bounds.w / rect.width / view.k;
    if (pointers.current.size === 1) {
      setView((v) => ({ ...v, x: v.x + (cur.x - prev.x) * unitsPerPx * v.k, y: v.y + (cur.y - prev.y) * unitsPerPx * v.k }));
    } else if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.min(3.5, Math.max(0.6, pinch.current.k * (dist / pinch.current.dist)));
      setView((v) => ({ ...v, k }));
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onWheel = (e) => {
    const dk = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => ({ ...v, k: Math.min(3.5, Math.max(0.6, v.k * dk)) }));
  };

  const center = { x: bounds.minX + bounds.w / 2, y: bounds.minY + bounds.h / 2 };
  const transform = `translate(${center.x} ${center.y}) scale(${view.k}) translate(${-center.x + view.x / view.k} ${-center.y + view.y / view.k})`;

  return (
    <svg
      ref={svgRef}
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <g transform={transform}>
        {/* tiles */}
        {state.board.hexes.map((hex) => {
          const pts = hexCorners(hex.q, hex.r).map((p) => `${p.x},${p.y}`).join(' ');
          return (
            <g key={hex.id}>
              <polygon className="hex-poly" points={pts} fill={RES_COLORS[hex.resource]} />
              {hex.token != null && <Token hex={hex} />}
            </g>
          );
        })}

        {/* ports */}
        {state.board.ports.map((port, i) => (
          <Port key={i} port={port} graph={graph} hexes={state.board.hexes} />
        ))}

        {/* roads */}
        {Object.entries(state.occ.edges).map(([eid, owner]) => {
          const e = graph.edges[eid];
          const v1 = graph.vertices[e.v1];
          const v2 = graph.vertices[e.v2];
          // Shorten slightly so roads don't overlap building corners.
          const t = 0.16;
          const x1 = v1.x + (v2.x - v1.x) * t;
          const y1 = v1.y + (v2.y - v1.y) * t;
          const x2 = v2.x - (v2.x - v1.x) * t;
          const y2 = v2.y - (v2.y - v1.y) * t;
          return (
            <g key={eid}>
              <line className="road" x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2b2b33" strokeWidth={1.9} />
              <line className="road" x1={x1} y1={y1} x2={x2} y2={y2} stroke={PLAYER_COLORS[owner]} strokeWidth={1.25} />
            </g>
          );
        })}

        {/* buildings */}
        {Object.entries(state.occ.vertices).map(([vid, b]) => {
          const v = graph.vertices[vid];
          return b.type === 'city'
            ? <City key={vid} x={v.x} y={v.y} color={PLAYER_COLORS[b.player]} />
            : <Settlement key={vid} x={v.x} y={v.y} color={PLAYER_COLORS[b.player]} />;
        })}

        {/* robber */}
        <Robber hex={state.board.hexes[state.board.robberHex]} />

        {/* interactive highlights */}
        {highlightHexes && state.board.hexes.filter((h) => highlightHexes.has(h.id)).map((hex) => {
          const pts = hexCorners(hex.q, hex.r).map((p) => `${p.x},${p.y}`).join(' ');
          return (
            <polygon
              key={`rh${hex.id}`}
              className="robber-hex-target"
              points={pts}
              onClick={() => onHexClick?.(hex.id)}
            />
          );
        })}
        {highlightEdges && [...highlightEdges].map((eid) => {
          const e = graph.edges[eid];
          if (!e) return null;
          const v1 = graph.vertices[e.v1];
          const v2 = graph.vertices[e.v2];
          return (
            <line
              key={`he${eid}`}
              className="spot"
              x1={v1.x} y1={v1.y} x2={v2.x} y2={v2.y}
              stroke="rgba(62,124,143,0.9)"
              strokeWidth={1.6}
              strokeLinecap="round"
              style={{ cursor: 'pointer' }}
              onClick={() => onEdgeClick?.(eid)}
            />
          );
        })}
        {highlightVertices && [...highlightVertices].map((vid) => {
          const v = graph.vertices[vid];
          if (!v) return null;
          return (
            <circle
              key={`hv${vid}`}
              className="spot"
              cx={v.x} cy={v.y} r={1.7}
              onClick={() => onVertexClick?.(vid)}
            />
          );
        })}
      </g>
    </svg>
  );
}
