// AI bots. Given a state where it is the bot's moment to act, botAction()
// returns the single next action to take. The host applies it through the
// same reduce() path as human intents, so bots can never cheat.
//
// Levels:
//   easy   – random-but-legal, builds when affordable
//   medium – pip-count placement, resource diversity, sensible bank trades
//   hard   – adds robber targeting, knight/dev usage, expansion planning
//     and blocking the leading opponent.

import { RESOURCES, COSTS } from './constants.js';
import {
  graphOf, currentActor, publicVP, totalVP,
  legalSettlementVertices, legalRoadEdges, legalCityVertices, legalRobberHexes,
  robberVictims, tradeRatio, hasResources, countResources, emptyResources,
} from './game.js';

const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function vertexScore(state, graph, vid, idx) {
  const v = graph.vertices[vid];
  let pips = 0;
  const kinds = new Set();
  for (const hexId of v.hexes) {
    const hex = state.board.hexes[hexId];
    if (hex.resource === 'desert' || hex.token == null) continue;
    pips += PIPS[hex.token] || 0;
    kinds.add(hex.resource);
  }
  // Diversity bonus, plus a nudge toward resources the bot lacks entirely.
  let score = pips + kinds.size * 1.5;
  const mine = myResourceKinds(state, graph, idx);
  for (const k of kinds) if (!mine.has(k)) score += 1.5;
  return score;
}

function myResourceKinds(state, graph, idx) {
  const kinds = new Set();
  for (const [vid, b] of Object.entries(state.occ.vertices)) {
    if (b.player !== idx) continue;
    for (const hexId of graph.vertices[vid].hexes) {
      const hex = state.board.hexes[hexId];
      if (hex.resource !== 'desert') kinds.add(hex.resource);
    }
  }
  return kinds;
}

function bestBy(items, scoreFn, randomness = 0) {
  if (items.length === 0) return null;
  const scored = items.map((it) => ({ it, s: scoreFn(it) + Math.random() * randomness }));
  scored.sort((a, b) => b.s - a.s);
  return scored[0].it;
}

// What the bot most wants to build next, in priority order.
function buildGoal(state, graph, idx) {
  const p = state.players[idx];
  if (legalCityVertices(state, idx).length > 0 && p.pieces.city > 0) return 'city';
  if (legalSettlementVertices(state, graph, idx).length > 0 && p.pieces.settlement > 0) return 'settlement';
  if (p.pieces.settlement > 0) return 'road'; // expand toward a spot
  return 'devCard';
}

// Missing resources for a cost, as {resource: count}.
function missingFor(p, cost) {
  const miss = {};
  for (const r of RESOURCES) {
    const short = (cost[r] || 0) - p.resources[r];
    if (short > 0) miss[r] = short;
  }
  return miss;
}

function discardChoice(state, idx, owed) {
  const p = state.players[idx];
  const hand = { ...p.resources };
  const keepFor = COSTS[buildGoal(state, graphOf(state), idx)] || {};
  const out = emptyResources();
  let left = owed;
  // First shed whatever the current goal does not need, most-held first.
  const order = [...RESOURCES].sort((a, b) => hand[b] - hand[a]);
  for (const wantedPass of [false, true]) {
    for (const r of order) {
      while (left > 0 && hand[r] > 0 && (wantedPass || !(keepFor[r] > 0))) {
        hand[r] -= 1;
        out[r] += 1;
        left -= 1;
      }
    }
    if (left === 0) break;
  }
  return out;
}

function robberChoice(state, graph, idx, level) {
  const hexes = legalRobberHexes(state);
  const scored = hexes.map((hexId) => {
    const victims = robberVictims(state, graph, hexId, idx);
    let denied = 0;
    let hitsMe = 0;
    for (const v of Object.values(graph.vertices)) {
      if (!v.hexes.includes(hexId)) continue;
      const b = state.occ.vertices[v.id];
      if (!b) continue;
      const hex = state.board.hexes[hexId];
      const pips = hex.token ? PIPS[hex.token] : 0;
      if (b.player === idx) hitsMe += pips;
      else denied += pips * (b.type === 'city' ? 2 : 1);
    }
    const bestVictim = bestBy(victims, (v) => totalVP(state, v) + countResources(state.players[v].resources) / 10);
    return { hexId, victims, denied, hitsMe, bestVictim };
  });

  if (level === 'easy') {
    const safe = scored.filter((s) => s.hitsMe === 0);
    const choice = pick(safe.length ? safe : scored);
    return { hex: choice.hexId, victim: choice.victims.length ? pick(choice.victims) : null };
  }
  const best = bestBy(scored, (s) => s.denied - s.hitsMe * 2 + (s.bestVictim != null ? 2 : 0));
  return { hex: best.hexId, victim: best.bestVictim ?? (best.victims.length ? best.victims[0] : null) };
}

// A bank/port trade that moves the bot toward its goal, or null.
function bankTradeChoice(state, graph, idx) {
  const p = state.players[idx];
  const goal = buildGoal(state, graph, idx);
  const cost = COSTS[goal === 'road' ? 'road' : goal];
  const miss = missingFor(p, cost);
  const wanted = Object.keys(miss);
  if (wanted.length === 0) return null;
  for (const give of RESOURCES) {
    if (cost[give] > 0 && p.resources[give] - (cost[give] || 0) < tradeRatio(state, graph, idx, give)) continue;
    const ratio = tradeRatio(state, graph, idx, give);
    const surplus = p.resources[give] - (cost[give] || 0);
    if (surplus >= ratio) {
      const get = wanted.find((r) => state.bank[r] > 0);
      if (get && get !== give) return { type: 'bank_trade', give, get };
    }
  }
  return null;
}

// Score a road edge by the best future settlement spot it opens up.
function roadScore(state, graph, eid, idx) {
  const e = graph.edges[eid];
  let best = 0;
  for (const vid of [e.v1, e.v2]) {
    if (!state.occ.vertices[vid]) {
      // Could settle here later?
      const ok = graph.vertices[vid].adjVertices.every((v) => !state.occ.vertices[v]);
      if (ok) best = Math.max(best, vertexScore(state, graph, vid, idx));
      // Look one step further for expansion potential.
      for (const nv of graph.vertices[vid].adjVertices) {
        if (state.occ.vertices[nv]) continue;
        const ok2 = graph.vertices[nv].adjVertices.every((v) => !state.occ.vertices[v]);
        if (ok2) best = Math.max(best, vertexScore(state, graph, nv, idx) * 0.6);
      }
    }
  }
  return best;
}

function mainPhaseAction(state, graph, idx, level) {
  const p = state.players[idx];
  const randomness = level === 'easy' ? 100 : level === 'medium' ? 2 : 0.5;

  // Hard bots play knights: to unblock their own tiles or chase Largest Army.
  if (level === 'hard' && !state.turn.devPlayed && p.dev.knight > 0) {
    const robberHex = state.board.robberHex;
    const blocksMe = Object.entries(state.occ.vertices).some(
      ([vid, b]) => b.player === idx && graph.vertices[vid].hexes.includes(robberHex),
    );
    const laReachable = p.knightsPlayed + 1 >= 3 && p.knightsPlayed + 1 > state.largestArmy.count;
    if (blocksMe || laReachable) return { type: 'play_dev', card: 'knight' };
  }
  if (level !== 'easy' && !state.turn.devPlayed) {
    if (p.dev.yearOfPlenty > 0) {
      const goal = COSTS[buildGoal(state, graph, idx)];
      const miss = Object.entries(missingFor(p, goal)).flatMap(([r, n]) => Array(n).fill(r));
      if (miss.length > 0 && miss.length <= 2) {
        const picks = [miss[0], miss[1] || miss[0]];
        // Count duplicates: taking 2 of one resource needs 2 in the bank.
        const wanted = {};
        for (const r of picks) wanted[r] = (wanted[r] || 0) + 1;
        if (Object.entries(wanted).every(([r, n]) => state.bank[r] >= n)) {
          return { type: 'play_dev', card: 'yearOfPlenty', resources: picks };
        }
      }
    }
    if (p.dev.monopoly > 0 && level === 'hard') {
      const counts = emptyResources();
      state.players.forEach((o, i) => {
        if (i !== idx) for (const r of RESOURCES) counts[r] += o.resources[r];
      });
      const best = bestBy(RESOURCES, (r) => counts[r]);
      if (counts[best] >= 4) return { type: 'play_dev', card: 'monopoly', resource: best };
    }
    if (p.dev.roadBuilding > 0 && p.pieces.road >= 2) {
      const first = bestBy(legalRoadEdges(state, graph, idx), (e) => roadScore(state, graph, e, idx), randomness);
      if (first) return { type: 'play_dev', card: 'roadBuilding', edges: [first] };
    }
  }

  // Build in value order: city, settlement, road-toward-spot, dev card.
  if (hasResources(p.resources, COSTS.city) && p.pieces.city > 0) {
    const spots = legalCityVertices(state, idx);
    const spot = bestBy(spots, (v) => vertexScore(state, graph, v, idx), randomness);
    if (spot) return { type: 'build_city', vertex: spot };
  }
  if (hasResources(p.resources, COSTS.settlement) && p.pieces.settlement > 0) {
    const spots = legalSettlementVertices(state, graph, idx);
    const spot = bestBy(spots, (v) => vertexScore(state, graph, v, idx), randomness);
    if (spot) return { type: 'build_settlement', vertex: spot };
  }
  if (hasResources(p.resources, COSTS.road) && p.pieces.road > 0) {
    const spots = legalRoadEdges(state, graph, idx);
    // Easy builds any road; others only roads that go somewhere useful.
    const spot = bestBy(spots, (e) => roadScore(state, graph, e, idx), randomness);
    const worthIt = level === 'easy' || (spot && roadScore(state, graph, spot, idx) > 3)
      || legalSettlementVertices(state, graph, idx).length === 0;
    if (spot && worthIt && (level === 'easy' || Object.keys(state.occ.edges).filter((e) => state.occ.edges[e] === idx).length < 13)) {
      return { type: 'build_road', edge: spot };
    }
  }
  if (hasResources(p.resources, COSTS.devCard) && state.devDeck.length > 0
    && (level !== 'easy' || Math.random() < 0.4)) {
    return { type: 'buy_dev' };
  }
  // All levels convert surplus at the bank — otherwise a walled-in player
  // (no legal spots, no pieces) can never make progress again.
  const trade = bankTradeChoice(state, graph, idx);
  if (trade) return trade;
  return { type: 'end_turn' };
}

// The one decision the bot must make right now, or null if it's not the
// bot's moment (also answers pending trades addressed to the bot).
export function botAction(state, idx) {
  if (state.phase === 'ended') return null;
  const p = state.players[idx];
  const level = p.botLevel || 'medium';
  const graph = graphOf(state);

  // Respond to a pending trade even when it is not the bot's turn.
  if (state.trade && state.trade.from !== idx && state.trade.responses[idx] === undefined) {
    let accept = false;
    if (level !== 'easy' && hasResources(p.resources, state.trade.want)) {
      const gain = countResources(state.trade.offer);
      const cost = countResources(state.trade.want);
      const goal = COSTS[buildGoal(state, graph, idx)];
      const helps = Object.keys(state.trade.offer).some((r) => (goal[r] || 0) > p.resources[r]);
      accept = gain >= cost && (level === 'medium' ? helps || gain > cost : helps);
      // Don't feed the leader.
      if (level === 'hard' && publicVP(state, state.trade.from) >= state.settings.targetVP - 2) accept = false;
    }
    return { type: 'respond_trade', accept };
  }

  if (currentActor(state) !== idx) return null;

  const t = state.turn;
  if (state.phase === 'setup') {
    if (state.setup.sub === 'settlement') {
      const spots = legalSettlementVertices(state, graph, idx);
      const spot = level === 'easy'
        ? pick(spots)
        : bestBy(spots, (v) => vertexScore(state, graph, v, idx), level === 'medium' ? 1.5 : 0.3);
      return { type: 'place_settlement', vertex: spot };
    }
    const edges = legalRoadEdges(state, graph, idx);
    const edge = level === 'easy' ? pick(edges) : bestBy(edges, (e) => roadScore(state, graph, e, idx), 1);
    return { type: 'place_road', edge };
  }

  if (t.phase === 'roll') {
    // The bot's active trade offer never survives to a new turn, so rolling is safe.
    return { type: 'roll' };
  }
  if (t.phase === 'discard') {
    const owed = t.pendingDiscards?.[idx];
    if (!owed) return null;
    return { type: 'discard', resources: discardChoice(state, idx, owed) };
  }
  if (t.phase === 'robber') {
    const { hex, victim } = robberChoice(state, graph, idx, level);
    return { type: 'move_robber', hex, victim };
  }
  if (t.phase === 'special') {
    const p2 = state.players[idx];
    if (hasResources(p2.resources, COSTS.city) && legalCityVertices(state, idx).length > 0 && p2.pieces.city > 0) {
      const spot = bestBy(legalCityVertices(state, idx), (v) => vertexScore(state, graph, v, idx));
      return { type: 'build_city', vertex: spot };
    }
    if (hasResources(p2.resources, COSTS.settlement) && p2.pieces.settlement > 0) {
      const spots = legalSettlementVertices(state, graph, idx);
      if (spots.length > 0) {
        return { type: 'build_settlement', vertex: bestBy(spots, (v) => vertexScore(state, graph, v, idx)) };
      }
    }
    return { type: 'end_special' };
  }
  if (t.phase === 'main') {
    // If the bot proposed a trade (hard bots may later), resolve it first.
    if (state.trade && state.trade.from === idx) {
      const accepted = Object.entries(state.trade.responses).find(([, r]) => r === 'accepted');
      if (accepted) return { type: 'confirm_trade', with: Number(accepted[0]) };
      const everyoneAnswered = Object.keys(state.trade.responses).length >= state.players.length - 1;
      if (everyoneAnswered) return { type: 'cancel_trade' };
      return null; // wait for responses
    }
    return mainPhaseAction(state, graph, idx, level);
  }
  return null;
}
