// Longest-road computation: the longest continuous path of one player's
// roads. Each road segment may be used once per path; branching and loops are
// allowed. A path cannot continue through a vertex occupied by another
// player's settlement or city (the classic "cut" rule).

export function longestRoadLength(graph, occ, playerIndex) {
  const myEdges = Object.entries(occ.edges)
    .filter(([, owner]) => owner === playerIndex)
    .map(([id]) => id);
  if (myEdges.length === 0) return 0;

  const mySet = new Set(myEdges);

  const passable = (vid) => {
    const b = occ.vertices[vid];
    return !b || b.player === playerIndex;
  };

  let best = 0;
  const used = new Set();

  const dfs = (vid, length) => {
    if (length > best) best = length;
    for (const eid of graph.vertices[vid].adjEdges) {
      if (!mySet.has(eid) || used.has(eid)) continue;
      const e = graph.edges[eid];
      const next = e.v1 === vid ? e.v2 : e.v1;
      used.add(eid);
      // We may arrive AT a blocked vertex (the segment still counts) but we
      // may not continue THROUGH it.
      if (passable(next)) dfs(next, length + 1);
      else if (length + 1 > best) best = length + 1;
      used.delete(eid);
    }
  };

  // Start from every endpoint of every owned edge (covers all path shapes).
  const startVertices = new Set();
  for (const eid of myEdges) {
    const e = graph.edges[eid];
    if (passable(e.v1)) startVertices.add(e.v1);
    if (passable(e.v2)) startVertices.add(e.v2);
  }
  for (const vid of startVertices) dfs(vid, 0);

  // Edge case: a single segment between two blocked vertices still counts as 1.
  if (best === 0 && myEdges.length > 0) best = 1;
  return best;
}

// Recompute the Longest Road holder after a change. Rules:
// - needs length >= 5
// - the current holder keeps the title on ties
// - if the holder's road is cut below everyone else, the title moves only to
//   a single strict leader; on a tie among others (or nobody >= 5) it lapses.
export function updateLongestRoad(state, graph) {
  if (!state.settings.longestRoadEnabled) return;
  const lengths = state.players.map((_, i) => longestRoadLength(graph, state.occ, i));
  const holder = state.longestRoad.player;
  const max = Math.max(...lengths);

  if (max < 5) {
    state.longestRoad = { player: null, length: 0 };
    return;
  }
  if (holder !== null && lengths[holder] >= 5 && lengths[holder] >= max) {
    state.longestRoad.length = lengths[holder];
    return; // holder keeps it on ties
  }
  const leaders = lengths
    .map((len, i) => ({ len, i }))
    .filter((x) => x.len === max);
  if (leaders.length === 1) {
    state.longestRoad = { player: leaders[0].i, length: max };
  } else if (holder !== null && leaders.some((l) => l.i === holder)) {
    state.longestRoad = { player: holder, length: max };
  } else {
    // Tie between non-holders: nobody holds the title.
    state.longestRoad = { player: null, length: max };
  }
}
