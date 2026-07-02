// Board generation and the hex/vertex/edge graph.
//
// Hexes are pointy-top, addressed with axial coordinates (q, r). The vertex
// and edge graph is derived from hex corner pixel positions rounded to a
// grid, which gives every client the exact same ids for the same hex layout
// without any error-prone corner-coordinate algebra. Only the hex list (and
// ports) is stored in the game state; the graph is rebuilt deterministically.

import {
  TERRAIN_BASE, TOKENS_BASE, TERRAIN_LARGE, TOKENS_LARGE,
  PORTS_BASE, PORTS_LARGE,
} from './constants.js';
import { shuffled, randInt } from './rng.js';

export const HEX_SIZE = 10; // abstract units; the UI scales freely

export function hexCenter(q, r) {
  return {
    x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    y: HEX_SIZE * 1.5 * r,
  };
}

export function hexCorners(q, r) {
  const c = hexCenter(q, r);
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 90); // corners, starting at top
    pts.push({ x: c.x + HEX_SIZE * Math.cos(angle), y: c.y + HEX_SIZE * Math.sin(angle) });
  }
  return pts;
}

function pointKey(p) {
  // Round to a coarse grid so floating-point noise cannot split one corner
  // into two vertices. Corner spacing is ~HEX_SIZE, so /10 is plenty fine.
  return `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
}

// Axial coordinates for the 19-hex board: hexagon of radius 2.
function baseLayout() {
  const coords = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) <= 2) coords.push({ q, r });
    }
  }
  return coords;
}

// Axial coordinates for the 30-hex board: rows of 3,4,5,6,5,4,3.
function largeLayout() {
  const rowLens = [3, 4, 5, 6, 5, 4, 3];
  const coords = [];
  for (let row = 0; row < rowLens.length; row++) {
    const len = rowLens[row];
    const colStart = Math.floor((6 - len) / 2);
    for (let i = 0; i < len; i++) {
      const col = colStart + i;
      // odd-r offset -> axial
      const q = col - (row - (row & 1)) / 2;
      const r = row - 3; // center vertically
      coords.push({ q, r });
    }
  }
  return coords;
}

const HEX_NEIGHBOR_DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function hexesAdjacent(a, b) {
  return HEX_NEIGHBOR_DIRS.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

// Build the full graph from a hex list. Returns { vertices, edges } maps.
// vertices[id] = { id, x, y, hexes: [hexId], adjVertices: [id], adjEdges: [id] }
// edges[id]    = { id, v1, v2, hexes: [hexId] }
export function buildGraph(hexes) {
  const vertices = {};
  const edges = {};
  for (const hex of hexes) {
    const corners = hexCorners(hex.q, hex.r);
    const ids = corners.map((p) => pointKey(p));
    corners.forEach((p, i) => {
      const id = ids[i];
      if (!vertices[id]) {
        vertices[id] = { id, x: p.x, y: p.y, hexes: [], adjVertices: [], adjEdges: [] };
      }
      vertices[id].hexes.push(hex.id);
    });
    for (let i = 0; i < 6; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % 6];
      const eid = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edges[eid]) edges[eid] = { id: eid, v1: a < b ? a : b, v2: a < b ? b : a, hexes: [] };
      edges[eid].hexes.push(hex.id);
    }
  }
  for (const e of Object.values(edges)) {
    vertices[e.v1].adjVertices.push(e.v2);
    vertices[e.v2].adjVertices.push(e.v1);
    vertices[e.v1].adjEdges.push(e.id);
    vertices[e.v2].adjEdges.push(e.id);
  }
  return { vertices, edges };
}

// Coastal edges (touching exactly one hex) ordered by walking the perimeter.
function coastalLoop(graph) {
  const coastal = Object.values(graph.edges).filter((e) => e.hexes.length === 1);
  const byVertex = {};
  for (const e of coastal) {
    (byVertex[e.v1] ||= []).push(e);
    (byVertex[e.v2] ||= []).push(e);
  }
  const loop = [];
  const used = new Set();
  let current = coastal[0];
  let fromVertex = current.v1;
  while (current && !used.has(current.id)) {
    used.add(current.id);
    loop.push(current);
    const nextVertex = current.v1 === fromVertex ? current.v2 : current.v1;
    current = (byVertex[nextVertex] || []).find((e) => !used.has(e.id));
    fromVertex = nextVertex;
  }
  return loop;
}

function tokensOk(hexes) {
  // The classic setup rule: 6s and 8s must not sit on adjacent hexes.
  const hot = hexes.filter((h) => h.token === 6 || h.token === 8);
  for (let i = 0; i < hot.length; i++) {
    for (let j = i + 1; j < hot.length; j++) {
      if (hexesAdjacent(hot[i], hot[j])) return false;
    }
  }
  return true;
}

// Generate a random board. `rngHolder` is a mutable { state } PRNG holder.
// Returns { hexes, ports, robberHex } — everything the game state stores.
export function generateBoard(rngHolder, playerCount) {
  const large = playerCount >= 5;
  const coords = large ? largeLayout() : baseLayout();
  const terrainPool = large ? TERRAIN_LARGE : TERRAIN_BASE;
  const tokenPool = large ? TOKENS_LARGE : TOKENS_BASE;
  const portPool = large ? PORTS_LARGE : PORTS_BASE;

  let hexes;
  for (let attempt = 0; ; attempt++) {
    const terrain = shuffled(rngHolder, terrainPool);
    const tokens = shuffled(rngHolder, tokenPool);
    let t = 0;
    hexes = coords.map(({ q, r }, i) => ({
      id: i,
      q,
      r,
      resource: terrain[i],
      token: terrain[i] === 'desert' ? null : tokens[t++],
    }));
    if (tokensOk(hexes) || attempt > 200) break;
  }

  const graph = buildGraph(hexes);
  const loop = coastalLoop(graph);
  const kinds = shuffled(rngHolder, portPool);
  const ports = [];
  const step = loop.length / kinds.length;
  const offset = randInt(rngHolder, loop.length);
  for (let i = 0; i < kinds.length; i++) {
    const edge = loop[(offset + Math.round(i * step)) % loop.length];
    ports.push({ kind: kinds[i], vertices: [edge.v1, edge.v2], edgeId: edge.id });
  }

  const robberHex = hexes.find((h) => h.resource === 'desert').id;
  return { hexes, ports, robberHex };
}
