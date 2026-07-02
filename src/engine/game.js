// The authoritative game engine: pure functions over a JSON-serializable
// game state. No network, no DOM, no timers — the host (and the tests, and
// hot-seat mode) drive it by calling reduce(state, action).
//
// All randomness flows through the PRNG state stored on the game state, so
// applying the same actions to the same state always yields the same result.

import {
  RESOURCES, COSTS, PIECE_LIMITS,
  DEV_DECK_BASE, DEV_DECK_LARGE,
  BANK_PER_RESOURCE_BASE, BANK_PER_RESOURCE_LARGE,
  PLAYER_COLORS, DEFAULT_SETTINGS,
} from './constants.js';
import { generateBoard, buildGraph } from './board.js';
import { updateLongestRoad } from './longestRoad.js';
import { randInt, shuffled, newSeed } from './rng.js';

export class GameError extends Error {}

const fail = (msg) => { throw new GameError(msg); };
const need = (cond, msg) => { if (!cond) fail(msg); };

// ---------------------------------------------------------------- resources

export const emptyResources = () =>
  Object.fromEntries(RESOURCES.map((r) => [r, 0]));

export const countResources = (res) =>
  RESOURCES.reduce((n, r) => n + (res[r] || 0), 0);

export const hasResources = (have, cost) =>
  RESOURCES.every((r) => (have[r] || 0) >= (cost[r] || 0));

const move = (from, to, cost) => {
  for (const r of RESOURCES) {
    const n = cost[r] || 0;
    from[r] -= n;
    to[r] += n;
  }
};

// ------------------------------------------------------------- game creation

export function createGame({ players, settings = {}, seed = newSeed() }) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  const n = players.length;
  need(n >= 2 && n <= 6, 'Game needs 2-6 players');
  const large = n >= 5;
  const rng = { state: seed | 0 };
  const board = generateBoard(rng, n);

  const deckSpec = large ? DEV_DECK_LARGE : DEV_DECK_BASE;
  const deck = shuffled(
    rng,
    Object.entries(deckSpec).flatMap(([card, count]) => Array(count).fill(card)),
  );

  const perResource = large ? BANK_PER_RESOURCE_LARGE : BANK_PER_RESOURCE_BASE;

  // Snake-draft setup order: 0..n-1 then n-1..0.
  const order = [...players.keys(), ...[...players.keys()].reverse()];

  return {
    v: 1, // state version; the host bumps it on every write
    seed,
    rngState: rng.state,
    settings: merged,
    players: players.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: PLAYER_COLORS[i],
      isBot: !!p.isBot,
      botLevel: p.botLevel || 'medium',
      resources: emptyResources(),
      dev: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, vp: 0 },
      newDev: { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
      knightsPlayed: 0,
      pieces: { ...PIECE_LIMITS },
    })),
    board,
    occ: { vertices: {}, edges: {} },
    bank: Object.fromEntries(RESOURCES.map((r) => [r, perResource])),
    devDeck: deck,
    phase: 'setup',
    setup: { order, i: 0, sub: 'settlement', lastSettlement: null },
    turn: {
      player: order[0],
      phase: 'setup',
      dice: null,
      devPlayed: false,
      freeRoads: 0,
      pendingDiscards: null,
      phaseAfterRobber: null,
      special: null,
      deadline: null,
    },
    turnsCompleted: 0,
    trade: null,
    longestRoad: { player: null, length: 0 },
    largestArmy: { player: null, count: 0 },
    log: [{ t: 'start', ts: 0 }],
    chat: [],
    winner: null,
  };
}

// ------------------------------------------------------------------ queries

export function graphOf(state) {
  return buildGraph(state.board.hexes);
}

export function publicVP(state, idx) {
  const p = state.players[idx];
  const settlements = PIECE_LIMITS.settlement - p.pieces.settlement;
  const cities = PIECE_LIMITS.city - p.pieces.city;
  let vp = settlements + cities * 2;
  if (state.longestRoad.player === idx) vp += 2;
  if (state.largestArmy.player === idx) vp += 2;
  return vp;
}

export function totalVP(state, idx) {
  return publicVP(state, idx) + state.players[idx].dev.vp;
}

// Best maritime trade ratio for a player giving `resource`.
export function tradeRatio(state, graph, idx, resource) {
  let ratio = 4;
  for (const port of state.board.ports) {
    const owned = port.vertices.some((v) => state.occ.vertices[v]?.player === idx);
    if (!owned) continue;
    if (port.kind === '3:1') ratio = Math.min(ratio, 3);
    else if (port.kind === resource) ratio = Math.min(ratio, 2);
  }
  return ratio;
}

const distanceRuleOk = (state, graph, vid) => {
  if (state.occ.vertices[vid]) return false;
  return graph.vertices[vid].adjVertices.every((v) => !state.occ.vertices[v]);
};

// Does this vertex touch the player's road network?
const touchesOwnRoad = (state, graph, vid, idx) =>
  graph.vertices[vid].adjEdges.some((e) => state.occ.edges[e] === idx);

export function legalSettlementVertices(state, graph, idx) {
  const setup = state.phase === 'setup';
  return Object.keys(graph.vertices).filter((vid) => {
    if (!distanceRuleOk(state, graph, vid)) return false;
    return setup || touchesOwnRoad(state, graph, vid, idx);
  });
}

export function legalRoadEdges(state, graph, idx) {
  if (state.phase === 'setup') {
    // The setup road must attach to the settlement just placed.
    const vid = state.setup.lastSettlement;
    if (!vid) return [];
    return graph.vertices[vid].adjEdges.filter((e) => state.occ.edges[e] === undefined);
  }
  return Object.keys(graph.edges).filter((eid) => {
    if (state.occ.edges[eid] !== undefined) return false;
    const e = graph.edges[eid];
    return [e.v1, e.v2].some((vid) => {
      const b = state.occ.vertices[vid];
      if (b) return b.player === idx; // own building connects; opponent's blocks
      return touchesOwnRoad(state, graph, vid, idx);
    });
  });
}

export function legalCityVertices(state, idx) {
  return Object.entries(state.occ.vertices)
    .filter(([, b]) => b.player === idx && b.type === 'settlement')
    .map(([vid]) => vid);
}

export function legalRobberHexes(state) {
  return state.board.hexes
    .filter((h) => !(state.settings.robberMustMove && h.id === state.board.robberHex))
    .map((h) => h.id);
}

// Players who can be robbed after moving the robber to hexId.
export function robberVictims(state, graph, hexId, moverIdx) {
  const owners = new Set();
  for (const v of Object.values(graph.vertices)) {
    if (!v.hexes.includes(hexId)) continue;
    const b = state.occ.vertices[v.id];
    if (b && b.player !== moverIdx) owners.add(b.player);
  }
  return [...owners].filter((idx) => {
    if (countResources(state.players[idx].resources) === 0) return false;
    if (state.settings.friendlyRobber && totalVP(state, idx) <= 2) return false;
    return true;
  });
}

// The player expected to act right now (for bots and the turn timer).
export function currentActor(state) {
  if (state.phase === 'ended') return null;
  const t = state.turn;
  if (t.phase === 'discard') {
    const idx = Object.keys(t.pendingDiscards || {})[0];
    return idx === undefined ? null : Number(idx);
  }
  if (t.phase === 'special') return t.special.queue[t.special.i];
  return t.player;
}

// ------------------------------------------------------------------ helpers

const log = (state, entry, ts) => {
  state.log.push({ ...entry, ts: ts ?? 0 });
  if (state.log.length > 500) state.log.splice(0, state.log.length - 250);
};

const rngOf = (state) => ({
  get state() { return state.rngState; },
  set state(v) { state.rngState = v; },
});

function checkWin(state, ts) {
  if (state.phase !== 'main') return;
  // You can only win on your own turn (never during the special building phase).
  if (state.turn.phase === 'special' || state.turn.phase === 'discard') return;
  const idx = state.turn.player;
  if (totalVP(state, idx) >= state.settings.targetVP) {
    state.phase = 'ended';
    state.winner = idx;
    log(state, { t: 'win', p: idx, vp: totalVP(state, idx) }, ts);
  }
}

function distribute(state, roll, ts) {
  const graph = graphOf(state);
  // demand[resource][playerIdx] = cards earned
  const demand = Object.fromEntries(RESOURCES.map((r) => [r, {}]));
  for (const hex of state.board.hexes) {
    if (hex.token !== roll || hex.id === state.board.robberHex) continue;
    for (const v of Object.values(graph.vertices)) {
      if (!v.hexes.includes(hex.id)) continue;
      const b = state.occ.vertices[v.id];
      if (!b) continue;
      const n = b.type === 'city' ? 2 : 1;
      demand[hex.resource][b.player] = (demand[hex.resource][b.player] || 0) + n;
    }
  }
  const gained = {};
  for (const r of RESOURCES) {
    const entries = Object.entries(demand[r]);
    if (entries.length === 0) continue;
    const total = entries.reduce((s, [, n]) => s + n, 0);
    if (total > state.bank[r] && entries.length > 1) continue; // bank shortage: nobody gets it
    for (const [idxStr, wanted] of entries) {
      const idx = Number(idxStr);
      const given = Math.min(wanted, state.bank[r]);
      if (given <= 0) continue;
      state.bank[r] -= given;
      state.players[idx].resources[r] += given;
      (gained[idx] ||= emptyResources())[r] += given;
    }
  }
  log(state, { t: 'gain', gained }, ts);
}

function placeRoad(state, graph, idx, eid, ts) {
  const p = state.players[idx];
  need(p.pieces.road > 0, 'No road pieces left');
  need(legalRoadEdges(state, graph, idx).includes(eid), 'Illegal road placement');
  state.occ.edges[eid] = idx;
  p.pieces.road -= 1;
  updateLongestRoad(state, graph);
  log(state, { t: 'road', p: idx }, ts);
}

function placeSettlement(state, graph, idx, vid, ts) {
  const p = state.players[idx];
  need(p.pieces.settlement > 0, 'No settlement pieces left');
  need(legalSettlementVertices(state, graph, idx).includes(vid), 'Illegal settlement placement');
  state.occ.vertices[vid] = { player: idx, type: 'settlement' };
  p.pieces.settlement -= 1;
  // A new settlement can cut an opponent's road.
  updateLongestRoad(state, graph);
  log(state, { t: 'settlement', p: idx }, ts);
}

function enterRobberPhase(state, returnTo) {
  state.turn.phaseAfterRobber = returnTo;
  state.turn.phase = 'robber';
}

function afterSeven(state, ts) {
  if (state.settings.discardOn7) {
    const pending = {};
    state.players.forEach((p, i) => {
      const n = countResources(p.resources);
      if (n >= 8) pending[i] = Math.floor(n / 2);
    });
    if (Object.keys(pending).length > 0) {
      state.turn.pendingDiscards = pending;
      state.turn.phase = 'discard';
      log(state, { t: 'discard-start', players: Object.keys(pending).map(Number) }, ts);
      return;
    }
  }
  enterRobberPhase(state, 'main');
}

function updateLargestArmy(state, idx) {
  if (!state.settings.largestArmyEnabled) return;
  const p = state.players[idx];
  const holder = state.largestArmy;
  if (p.knightsPlayed >= 3 && p.knightsPlayed > holder.count) {
    state.largestArmy = { player: idx, count: p.knightsPlayed };
  }
}

function advanceTurn(state, ts) {
  const n = state.players.length;
  state.trade = null;
  const p = state.players[state.turn.player];
  // Dev cards bought this turn become playable.
  for (const c of Object.keys(p.newDev)) {
    p.dev[c] += p.newDev[c];
    p.newDev[c] = 0;
  }
  state.turnsCompleted += 1;
  state.turn = {
    player: (state.turn.player + 1) % n,
    phase: 'roll',
    dice: null,
    devPlayed: false,
    freeRoads: 0,
    pendingDiscards: null,
    phaseAfterRobber: null,
    special: null,
    deadline: null,
  };
  log(state, { t: 'turn', p: state.turn.player }, ts);
  // The incoming player may already be at the target (e.g. gained Longest
  // Road through an opponent's road being cut, or built to 10 in the special
  // building phase).
  checkWin(state, ts);
}

function endActivePlayerTurn(state, ts) {
  if (state.players.length >= 5) {
    // Special Building Phase: everyone else, clockwise, may build.
    const n = state.players.length;
    const queue = [];
    for (let k = 1; k < n; k++) queue.push((state.turn.player + k) % n);
    state.turn.phase = 'special';
    state.turn.special = { queue, i: 0 };
    log(state, { t: 'special-start' }, ts);
  } else {
    advanceTurn(state, ts);
  }
}

function specialAdvance(state, ts) {
  const s = state.turn.special;
  s.i += 1;
  if (s.i >= s.queue.length) advanceTurn(state, ts);
}

// Which player index is allowed to take build actions right now, or null.
function builderNow(state, actor) {
  const t = state.turn;
  if (state.phase !== 'main') return false;
  if (t.phase === 'main') return actor === t.player;
  if (t.phase === 'special') return actor === t.special.queue[t.special.i];
  return false;
}

// ------------------------------------------------------------------ reducer

// action = { type, player: <playerIndex>, ts: <ms>, ...payload }
// Throws GameError on any illegal action; otherwise returns the next state.
export function reduce(prev, action) {
  const state = structuredClone(prev);
  const { type, player: actor, ts } = action;
  need(Number.isInteger(actor) && actor >= 0 && actor < state.players.length, 'Unknown player');

  if (type === 'chat') {
    const text = String(action.text || '').slice(0, 300).trim();
    need(text.length > 0, 'Empty message');
    state.chat.push({ p: actor, text, ts: ts ?? 0 });
    if (state.chat.length > 200) state.chat.splice(0, state.chat.length - 200);
    state.v += 1;
    return state;
  }

  need(state.phase !== 'ended', 'Game is over');
  const graph = graphOf(state);
  const p = state.players[actor];
  const rng = rngOf(state);

  switch (type) {
    // ------------------------------------------------------------- setup
    case 'place_settlement': {
      need(state.phase === 'setup' && state.setup.sub === 'settlement', 'Not placing settlements');
      need(actor === state.setup.order[state.setup.i], 'Not your placement');
      placeSettlement(state, graph, actor, action.vertex, ts);
      state.setup.lastSettlement = action.vertex;
      state.setup.sub = 'road';
      // Second settlement grants starting resources from its hexes.
      if (state.setup.i >= state.players.length) {
        for (const hexId of graph.vertices[action.vertex].hexes) {
          const hex = state.board.hexes[hexId];
          if (hex.resource !== 'desert' && state.bank[hex.resource] > 0) {
            state.bank[hex.resource] -= 1;
            p.resources[hex.resource] += 1;
          }
        }
      }
      break;
    }
    case 'place_road': {
      need(state.phase === 'setup' && state.setup.sub === 'road', 'Not placing roads');
      need(actor === state.setup.order[state.setup.i], 'Not your placement');
      placeRoad(state, graph, actor, action.edge, ts);
      state.setup.lastSettlement = null;
      state.setup.i += 1;
      state.setup.sub = 'settlement';
      if (state.setup.i >= state.setup.order.length) {
        state.phase = 'main';
        state.turn.player = 0;
        state.turn.phase = 'roll';
        log(state, { t: 'main-start' }, ts);
      } else {
        state.turn.player = state.setup.order[state.setup.i];
      }
      break;
    }

    // -------------------------------------------------------------- roll
    case 'roll': {
      need(state.phase === 'main' && state.turn.phase === 'roll', 'Not time to roll');
      need(actor === state.turn.player, 'Not your turn');
      let d1 = 1 + randInt(rng, 6);
      let d2 = 1 + randInt(rng, 6);
      if (state.settings.no7FirstTwoRounds) {
        const firstTwoRounds = state.turnsCompleted < state.players.length * 2;
        while (firstTwoRounds && d1 + d2 === 7) {
          d1 = 1 + randInt(rng, 6);
          d2 = 1 + randInt(rng, 6);
        }
      }
      state.turn.dice = [d1, d2];
      log(state, { t: 'roll', p: actor, dice: [d1, d2] }, ts);
      if (d1 + d2 === 7) afterSeven(state, ts);
      else {
        distribute(state, d1 + d2, ts);
        state.turn.phase = 'main';
      }
      break;
    }

    // ----------------------------------------------------------- discard
    case 'discard': {
      need(state.turn.phase === 'discard', 'No discard pending');
      const owed = state.turn.pendingDiscards?.[actor];
      need(owed, 'You have nothing to discard');
      const res = action.resources || {};
      const total = countResources(res);
      need(total === owed, `Must discard exactly ${owed} cards`);
      need(hasResources(p.resources, res), 'You do not have those cards');
      move(p.resources, state.bank, res);
      delete state.turn.pendingDiscards[actor];
      log(state, { t: 'discarded', p: actor, count: total }, ts);
      if (Object.keys(state.turn.pendingDiscards).length === 0) {
        state.turn.pendingDiscards = null;
        enterRobberPhase(state, 'main');
      }
      break;
    }

    // ------------------------------------------------------------ robber
    case 'move_robber': {
      need(state.turn.phase === 'robber', 'Robber is not active');
      need(actor === state.turn.player, 'Not your robber');
      need(legalRobberHexes(state).includes(action.hex), 'Robber must move to a different tile');
      state.board.robberHex = action.hex;
      const victims = robberVictims(state, graph, action.hex, actor);
      let stolen = null;
      if (action.victim !== null && action.victim !== undefined) {
        need(victims.includes(action.victim), 'Cannot steal from that player');
        const v = state.players[action.victim];
        const hand = RESOURCES.flatMap((r) => Array(v.resources[r]).fill(r));
        stolen = hand[randInt(rng, hand.length)];
        v.resources[stolen] -= 1;
        p.resources[stolen] += 1;
      } else {
        need(victims.length === 0, 'You must steal from an adjacent player');
      }
      log(state, { t: 'robber', p: actor, hex: action.hex, victim: action.victim ?? null }, ts);
      state.turn.phase = state.turn.phaseAfterRobber || 'main';
      state.turn.phaseAfterRobber = null;
      break;
    }

    // ---------------------------------------------------------- building
    case 'build_road': {
      need(builderNow(state, actor), 'You cannot build now');
      const free = state.turn.phase === 'main' && actor === state.turn.player && state.turn.freeRoads > 0;
      if (!free) need(hasResources(p.resources, COSTS.road), 'Cannot afford a road');
      placeRoad(state, graph, actor, action.edge, ts);
      if (free) state.turn.freeRoads -= 1;
      else move(p.resources, state.bank, COSTS.road);
      checkWin(state, ts); // longest road may have changed hands
      break;
    }
    case 'build_settlement': {
      need(builderNow(state, actor), 'You cannot build now');
      need(hasResources(p.resources, COSTS.settlement), 'Cannot afford a settlement');
      placeSettlement(state, graph, actor, action.vertex, ts);
      move(p.resources, state.bank, COSTS.settlement);
      checkWin(state, ts);
      break;
    }
    case 'build_city': {
      need(builderNow(state, actor), 'You cannot build now');
      need(hasResources(p.resources, COSTS.city), 'Cannot afford a city');
      need(p.pieces.city > 0, 'No city pieces left');
      const b = state.occ.vertices[action.vertex];
      need(b && b.player === actor && b.type === 'settlement', 'You can only upgrade your own settlement');
      b.type = 'city';
      p.pieces.city -= 1;
      p.pieces.settlement += 1; // the settlement piece returns to the player
      move(p.resources, state.bank, COSTS.city);
      log(state, { t: 'city', p: actor }, ts);
      checkWin(state, ts);
      break;
    }
    case 'buy_dev': {
      need(builderNow(state, actor), 'You cannot buy now');
      need(state.devDeck.length > 0, 'No development cards left');
      need(hasResources(p.resources, COSTS.devCard), 'Cannot afford a development card');
      move(p.resources, state.bank, COSTS.devCard);
      const card = state.devDeck.pop();
      if (card === 'vp') p.dev.vp += 1; // VP cards always count, never "played"
      else if (state.settings.devCardDelay) p.newDev[card] += 1;
      else p.dev[card] += 1;
      log(state, { t: 'buy-dev', p: actor }, ts);
      checkWin(state, ts);
      break;
    }

    // ------------------------------------------------------------- dev cards
    case 'play_dev': {
      const t = state.turn;
      need(state.phase === 'main', 'Not in play');
      need(actor === t.player, 'Not your turn');
      // A knight may also be played before rolling; everything else needs main phase.
      const card = action.card;
      if (card === 'knight') need(t.phase === 'main' || t.phase === 'roll', 'Cannot play that now');
      else need(t.phase === 'main', 'Cannot play that now');
      need(!t.devPlayed, 'Only one development card per turn');
      need((p.dev[card] || 0) > 0, 'You do not have that card');
      p.dev[card] -= 1;
      t.devPlayed = true;
      log(state, { t: 'dev', p: actor, card }, ts);

      if (card === 'knight') {
        p.knightsPlayed += 1;
        updateLargestArmy(state, actor);
        enterRobberPhase(state, t.phase === 'roll' ? 'roll' : 'main');
        checkWin(state, ts); // largest army can win
      } else if (card === 'roadBuilding') {
        const edges = (action.edges || []).slice(0, 2);
        const maxRoads = Math.min(2, p.pieces.road);
        need(maxRoads > 0, 'No road pieces left');
        need(edges.length >= 1 && edges.length <= maxRoads, 'Choose one or two road placements');
        // Placed one at a time: the first road can open spots for the second.
        for (const eid of edges) placeRoad(state, graph, actor, eid, ts);
        checkWin(state, ts);
      } else if (card === 'yearOfPlenty') {
        const picks = action.resources || [];
        need(picks.length === 2 && picks.every((r) => RESOURCES.includes(r)), 'Pick two resources');
        for (const r of picks) {
          need(state.bank[r] > 0, `The bank has no ${r}`);
          state.bank[r] -= 1;
          p.resources[r] += 1;
        }
      } else if (card === 'monopoly') {
        const r = action.resource;
        need(RESOURCES.includes(r), 'Pick a resource');
        let taken = 0;
        state.players.forEach((other, i) => {
          if (i === actor) return;
          taken += other.resources[r];
          other.resources[r] = 0;
        });
        p.resources[r] += taken;
        log(state, { t: 'monopoly', p: actor, resource: r, taken }, ts);
      } else {
        fail('Unknown development card');
      }
      break;
    }

    // ------------------------------------------------------------- trading
    case 'bank_trade': {
      need(state.phase === 'main' && state.turn.phase === 'main', 'Not in your build phase');
      need(actor === state.turn.player, 'Not your turn');
      const { give, get } = action;
      need(RESOURCES.includes(give) && RESOURCES.includes(get) && give !== get, 'Bad trade');
      const ratio = tradeRatio(state, graph, actor, give);
      need(p.resources[give] >= ratio, `Need ${ratio} ${give} to trade`);
      need(state.bank[get] > 0, `The bank has no ${get}`);
      p.resources[give] -= ratio;
      state.bank[give] += ratio;
      state.bank[get] -= 1;
      p.resources[get] += 1;
      log(state, { t: 'bank-trade', p: actor, give, ratio, get }, ts);
      break;
    }
    case 'offer_trade': {
      need(state.settings.playerTrading, 'Player trading is disabled');
      need(state.phase === 'main' && state.turn.phase === 'main', 'Not in your build phase');
      need(actor === state.turn.player, 'Only the active player can propose trades');
      const offer = action.offer || {};
      const want = action.want || {};
      need(countResources(offer) > 0 && countResources(want) > 0, 'Offer and request cannot be empty');
      need(hasResources(p.resources, offer), 'You do not have those cards');
      state.trade = { from: actor, offer, want, responses: {} };
      log(state, { t: 'trade-offer', p: actor, offer, want }, ts);
      break;
    }
    case 'respond_trade': {
      need(state.trade, 'No trade pending');
      need(actor !== state.trade.from, 'You proposed this trade');
      if (action.accept) {
        need(hasResources(p.resources, state.trade.want), 'You cannot afford this trade');
        state.trade.responses[actor] = 'accepted';
      } else {
        state.trade.responses[actor] = 'declined';
      }
      break;
    }
    case 'confirm_trade': {
      need(state.trade && actor === state.trade.from, 'No trade to confirm');
      const other = action.with;
      need(state.trade.responses[other] === 'accepted', 'That player has not accepted');
      const o = state.players[other];
      need(hasResources(p.resources, state.trade.offer), 'You no longer have those cards');
      need(hasResources(o.resources, state.trade.want), 'They no longer have those cards');
      move(p.resources, o.resources, state.trade.offer);
      move(o.resources, p.resources, state.trade.want);
      log(state, { t: 'trade', p: actor, with: other, offer: state.trade.offer, want: state.trade.want }, ts);
      state.trade = null;
      break;
    }
    case 'cancel_trade': {
      need(state.trade && actor === state.trade.from, 'No trade to cancel');
      state.trade = null;
      break;
    }

    // ---------------------------------------------------------- turn flow
    case 'end_turn': {
      need(state.phase === 'main' && state.turn.phase === 'main', 'Finish rolling first');
      need(actor === state.turn.player, 'Not your turn');
      endActivePlayerTurn(state, ts);
      break;
    }
    case 'end_special': {
      need(state.turn.phase === 'special', 'Not the special building phase');
      need(actor === state.turn.special.queue[state.turn.special.i], 'Not your building window');
      specialAdvance(state, ts);
      break;
    }

    default:
      fail(`Unknown action: ${type}`);
  }

  state.v += 1;
  return state;
}

// Non-throwing wrapper for the network layer.
export function tryReduce(state, action) {
  try {
    return { ok: true, state: reduce(state, action) };
  } catch (e) {
    if (e instanceof GameError) return { ok: false, error: e.message };
    throw e;
  }
}
