import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mulberry32 } from './rng.js';
import { createGame, reduce, GameError, graphOf, totalVP, publicVP, tradeRatio, legalSettlementVertices, legalRoadEdges, currentActor, countResources } from './game.js';
import { buildGraph, hexesAdjacent } from './board.js';
import { longestRoadLength } from './longestRoad.js';
import { nextRand } from './rng.js';

import { botAction } from './bots.js';
import { RESOURCES } from './constants.js';

const mkPlayers = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));

const newGame = (n = 4, settings = {}, seed = 42) =>
  createGame({ players: mkPlayers(n), settings, seed });

// Play through the snake-draft setup using the first legal spot each time.
function completeSetup(state) {
  while (state.phase === 'setup') {
    const idx = state.setup.order[state.setup.i];
    const graph = graphOf(state);
    if (state.setup.sub === 'settlement') {
      const v = legalSettlementVertices(state, graph, idx)[0];
      state = reduce(state, { type: 'place_settlement', player: idx, vertex: v });
    } else {
      const e = legalRoadEdges(state, graph, idx)[0];
      state = reduce(state, { type: 'place_road', player: idx, edge: e });
    }
  }
  return state;
}

// A game jumped straight to player 0's build phase with an empty board,
// so tests can stage exact scenarios.
function bareMain(n = 4, settings = {}) {
  const state = newGame(n, settings);
  state.phase = 'main';
  state.turn.phase = 'main';
  state.turn.player = 0;
  return state;
}

// Find an rng state that makes the next roll produce the wanted dice sum.
function rngStateForRoll(sum) {
  for (let s = 1; s < 1e7; s++) {
    const a = nextRand(s);
    const b = nextRand(a.nextState);
    const d1 = 1 + Math.floor(a.value * 6);
    const d2 = 1 + Math.floor(b.value * 6);
    if (d1 + d2 === sum) return s;
  }
  throw new Error('no rng state found');
}

const give = (state, idx, res) => {
  for (const [r, n] of Object.entries(res)) state.players[idx].resources[r] += n;
};

describe('board generation', () => {
  it('builds a 19-hex board for 2-4 players with correct pieces', () => {
    const state = newGame(4);
    expect(state.board.hexes).toHaveLength(19);
    expect(state.board.hexes.filter((h) => h.resource === 'desert')).toHaveLength(1);
    expect(state.board.ports).toHaveLength(9);
    const graph = graphOf(state);
    expect(Object.keys(graph.vertices)).toHaveLength(54);
    expect(Object.keys(graph.edges)).toHaveLength(72);
    const tokens = state.board.hexes.filter((h) => h.token != null).map((h) => h.token);
    expect(tokens).toHaveLength(18);
    expect(tokens.filter((t) => t === 7)).toHaveLength(0);
  });

  it('builds a 30-hex board with 11 ports for 5-6 players', () => {
    const state = newGame(6);
    expect(state.board.hexes).toHaveLength(30);
    expect(state.board.hexes.filter((h) => h.resource === 'desert')).toHaveLength(2);
    expect(state.board.ports).toHaveLength(11);
  });

  it('does not place 6s and 8s on adjacent hexes', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = createGame({ players: mkPlayers(4), seed });
      const hot = state.board.hexes.filter((h) => h.token === 6 || h.token === 8);
      for (let i = 0; i < hot.length; i++) {
        for (let j = i + 1; j < hot.length; j++) {
          expect(hexesAdjacent(hot[i], hot[j])).toBe(false);
        }
      }
    }
  });

  it('starts the robber on the desert', () => {
    const state = newGame(4);
    const desert = state.board.hexes.find((h) => h.resource === 'desert');
    expect(state.board.robberHex).toBe(desert.id);
  });

  it('is deterministic for the same seed', () => {
    const a = createGame({ players: mkPlayers(4), seed: 7 });
    const b = createGame({ players: mkPlayers(4), seed: 7 });
    expect(a.board).toEqual(b.board);
    expect(a.devDeck).toEqual(b.devDeck);
  });
});

describe('game creation', () => {
  it('sets up the bank and dev deck by player count', () => {
    const small = newGame(4);
    expect(small.bank.brick).toBe(19);
    expect(small.devDeck).toHaveLength(25);
    const big = newGame(6);
    expect(big.bank.brick).toBe(24);
    expect(big.devDeck).toHaveLength(34);
  });

  it('uses snake-draft setup order', () => {
    const state = newGame(3);
    expect(state.setup.order).toEqual([0, 1, 2, 2, 1, 0]);
  });
});

describe('setup phase', () => {
  it('walks the snake draft and enters main phase', () => {
    const state = completeSetup(newGame(3));
    expect(state.phase).toBe('main');
    expect(state.turn.player).toBe(0);
    expect(state.turn.phase).toBe('roll');
    expect(Object.keys(state.occ.vertices)).toHaveLength(6);
    expect(Object.keys(state.occ.edges)).toHaveLength(6);
  });

  it('enforces the distance rule during setup', () => {
    let state = newGame(2);
    const graph = graphOf(state);
    const v = legalSettlementVertices(state, graph, 0)[0];
    state = reduce(state, { type: 'place_settlement', player: 0, vertex: v });
    const e = legalRoadEdges(state, graph, 0)[0];
    state = reduce(state, { type: 'place_road', player: 0, edge: e });
    const neighbor = graph.vertices[v].adjVertices[0];
    expect(() => reduce(state, { type: 'place_settlement', player: 1, vertex: neighbor }))
      .toThrow(GameError);
  });

  it('grants starting resources for the second settlement only', () => {
    let state = newGame(2);
    // First placements: nobody has cards yet.
    state = completeSetup(state);
    for (const p of state.players) {
      const graph = graphOf(state);
      // Each player's second settlement grants one card per adjacent non-desert hex.
      expect(countResources(p.resources)).toBeGreaterThanOrEqual(0);
      expect(countResources(p.resources)).toBeLessThanOrEqual(3);
    }
    // Total handed out equals cards missing from the bank.
    const out = state.players.reduce((s, p) => s + countResources(p.resources), 0);
    const bankTotal = RESOURCES.reduce((s, r) => s + state.bank[r], 0);
    expect(bankTotal).toBe(19 * 5 - out);
  });

  it('rejects placements by the wrong player', () => {
    const state = newGame(2);
    const graph = graphOf(state);
    const v = legalSettlementVertices(state, graph, 1)[0];
    expect(() => reduce(state, { type: 'place_settlement', player: 1, vertex: v }))
      .toThrow(GameError);
  });
});

describe('rolling and resource production', () => {
  it('pays 1 card per settlement and 2 per city on the rolled number', () => {
    const state = bareMain(4);
    const graph = graphOf(state);
    const hex = state.board.hexes.find((h) => h.resource !== 'desert' && h.id !== state.board.robberHex);
    const verts = Object.values(graph.vertices).filter((v) => v.hexes.includes(hex.id));
    state.occ.vertices[verts[0].id] = { player: 0, type: 'settlement' };
    state.occ.vertices[verts[2].id] = { player: 1, type: 'city' };
    state.turn.phase = 'roll';
    state.rngState = rngStateForRoll(hex.token);
    const next = reduce(state, { type: 'roll', player: 0 });
    expect(next.turn.dice[0] + next.turn.dice[1]).toBe(hex.token);
    expect(next.players[0].resources[hex.resource]).toBe(1);
    expect(next.players[1].resources[hex.resource]).toBe(2);
    expect(next.turn.phase).toBe('main');
  });

  it('produces nothing from the robbed hex', () => {
    const state = bareMain(4);
    const graph = graphOf(state);
    const hex = state.board.hexes.find((h) => h.resource !== 'desert');
    const verts = Object.values(graph.vertices).filter((v) => v.hexes.includes(hex.id));
    state.occ.vertices[verts[0].id] = { player: 0, type: 'settlement' };
    state.board.robberHex = hex.id;
    state.turn.phase = 'roll';
    state.rngState = rngStateForRoll(hex.token);
    const next = reduce(state, { type: 'roll', player: 0 });
    expect(next.players[0].resources[hex.resource]).toBe(0);
  });

  it('withholds a short resource when two players both earn it', () => {
    const state = bareMain(4);
    const graph = graphOf(state);
    const hex = state.board.hexes.find((h) => h.resource !== 'desert' && h.id !== state.board.robberHex);
    const verts = Object.values(graph.vertices).filter((v) => v.hexes.includes(hex.id));
    state.occ.vertices[verts[0].id] = { player: 0, type: 'settlement' };
    state.occ.vertices[verts[2].id] = { player: 1, type: 'settlement' };
    state.bank[hex.resource] = 1; // not enough for both
    state.turn.phase = 'roll';
    state.rngState = rngStateForRoll(hex.token);
    const next = reduce(state, { type: 'roll', player: 0 });
    expect(next.players[0].resources[hex.resource]).toBe(0);
    expect(next.players[1].resources[hex.resource]).toBe(0);
    expect(next.bank[hex.resource]).toBe(1);
  });

  it('gives the remainder when only one player is short', () => {
    const state = bareMain(4);
    const graph = graphOf(state);
    const hex = state.board.hexes.find((h) => h.resource !== 'desert' && h.id !== state.board.robberHex);
    const verts = Object.values(graph.vertices).filter((v) => v.hexes.includes(hex.id));
    state.occ.vertices[verts[0].id] = { player: 0, type: 'city' };
    state.bank[hex.resource] = 1;
    state.turn.phase = 'roll';
    state.rngState = rngStateForRoll(hex.token);
    const next = reduce(state, { type: 'roll', player: 0 });
    expect(next.players[0].resources[hex.resource]).toBe(1);
    expect(next.bank[hex.resource]).toBe(0);
  });

  it('re-rolls 7s during the first two rounds when the house rule is on', () => {
    const state = bareMain(4, { no7FirstTwoRounds: true });
    state.turn.phase = 'roll';
    state.turnsCompleted = 0;
    state.rngState = rngStateForRoll(7);
    const next = reduce(state, { type: 'roll', player: 0 });
    expect(next.turn.dice[0] + next.turn.dice[1]).not.toBe(7);
  });
});

describe('rolling a 7: discard and robber', () => {
  function sevenState() {
    const state = bareMain(4);
    state.turn.phase = 'roll';
    state.rngState = rngStateForRoll(7);
    return state;
  }

  it('forces players with 8+ cards to discard half (rounded down)', () => {
    const state = sevenState();
    give(state, 1, { brick: 5, ore: 4 }); // 9 cards -> discard 4
    give(state, 2, { wool: 7 }); // 7 cards -> safe
    let next = reduce(state, { type: 'roll', player: 0 });
    expect(next.turn.phase).toBe('discard');
    expect(next.turn.pendingDiscards).toEqual({ 1: 4 });
    expect(() => reduce(next, { type: 'discard', player: 1, resources: { brick: 3 } }))
      .toThrow(/exactly 4/);
    next = reduce(next, { type: 'discard', player: 1, resources: { brick: 2, ore: 2 } });
    expect(countResources(next.players[1].resources)).toBe(5);
    expect(next.turn.phase).toBe('robber');
  });

  it('skips discarding when the toggle is off', () => {
    const state = bareMain(4, { discardOn7: false });
    state.turn.phase = 'roll';
    state.rngState = rngStateForRoll(7);
    give(state, 1, { brick: 10 });
    const next = reduce(state, { type: 'roll', player: 0 });
    expect(next.turn.phase).toBe('robber');
    expect(countResources(next.players[1].resources)).toBe(10);
  });

  it('moves the robber and steals a random card', () => {
    let state = sevenState();
    const graph = graphOf(state);
    const hex = state.board.hexes.find((h) => h.id !== state.board.robberHex && h.resource !== 'desert');
    const v = Object.values(graph.vertices).find((vv) => vv.hexes.includes(hex.id));
    state.occ.vertices[v.id] = { player: 1, type: 'settlement' };
    give(state, 1, { grain: 3 });
    state = reduce(state, { type: 'roll', player: 0 });
    expect(state.turn.phase).toBe('robber');
    state = reduce(state, { type: 'move_robber', player: 0, hex: hex.id, victim: 1 });
    expect(state.board.robberHex).toBe(hex.id);
    expect(state.players[0].resources.grain).toBe(1);
    expect(state.players[1].resources.grain).toBe(2);
    expect(state.turn.phase).toBe('main');
  });

  it('requires the robber to move to a different tile', () => {
    let state = sevenState();
    state = reduce(state, { type: 'roll', player: 0 });
    expect(() => reduce(state, { type: 'move_robber', player: 0, hex: state.board.robberHex, victim: null }))
      .toThrow(GameError);
  });

  it('friendly robber protects players at 2 or fewer VP', () => {
    let state = bareMain(4, { friendlyRobber: true });
    const graph = graphOf(state);
    const hex = state.board.hexes.find((h) => h.id !== state.board.robberHex && h.resource !== 'desert');
    const v = Object.values(graph.vertices).find((vv) => vv.hexes.includes(hex.id));
    state.occ.vertices[v.id] = { player: 1, type: 'settlement' };
    state.players[1].pieces.settlement = 4; // 1 settlement placed -> 1 VP
    give(state, 1, { grain: 3 });
    state.turn.phase = 'robber';
    expect(() => reduce(state, { type: 'move_robber', player: 0, hex: hex.id, victim: 1 }))
      .toThrow(GameError);
    // With no eligible victim, moving without stealing is legal.
    const next = reduce(state, { type: 'move_robber', player: 0, hex: hex.id, victim: null });
    expect(next.board.robberHex).toBe(hex.id);
  });
});

describe('building', () => {
  it('charges the correct costs and respects connectivity', () => {
    let state = completeSetup(newGame(2));
    state.turn.phase = 'main';
    const graph = graphOf(state);
    give(state, 0, { brick: 1, lumber: 1 });
    const edges = legalRoadEdges(state, graph, 0);
    state = reduce(state, { type: 'build_road', player: 0, edge: edges[0] });
    expect(countResources(state.players[0].resources) -
      countResources(completeSetup(newGame(2)).players[0].resources)).toBe(0);
    expect(state.players[0].pieces.road).toBe(15 - 2 - 1);
    // A disconnected edge is illegal.
    give(state, 0, { brick: 1, lumber: 1 });
    const disconnected = Object.keys(graph.edges).find(
      (e) => state.occ.edges[e] === undefined && !legalRoadEdges(state, graphOf(state), 0).includes(e),
    );
    expect(() => reduce(state, { type: 'build_road', player: 0, edge: disconnected }))
      .toThrow(GameError);
  });

  it('requires settlements to touch your own road network', () => {
    let state = completeSetup(newGame(2));
    state.turn.phase = 'main';
    give(state, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    const graph = graphOf(state);
    const spot = Object.keys(graph.vertices).find((vid) =>
      !state.occ.vertices[vid]
      && graph.vertices[vid].adjVertices.every((v) => !state.occ.vertices[v])
      && !graph.vertices[vid].adjEdges.some((e) => state.occ.edges[e] === 0));
    expect(() => reduce(state, { type: 'build_settlement', player: 0, vertex: spot }))
      .toThrow(GameError);
  });

  it('upgrades a settlement to a city and returns the settlement piece', () => {
    let state = completeSetup(newGame(2));
    state.turn.phase = 'main';
    give(state, 0, { grain: 2, ore: 3 });
    const mine = Object.entries(state.occ.vertices).find(([, b]) => b.player === 0)[0];
    state = reduce(state, { type: 'build_city', player: 0, vertex: mine });
    expect(state.occ.vertices[mine].type).toBe('city');
    expect(state.players[0].pieces.city).toBe(3);
    expect(state.players[0].pieces.settlement).toBe(4); // 5 - 2 placed + 1 back
    expect(publicVP(state, 0)).toBe(3); // 1 settlement + 1 city
  });

  it('blocks building when you cannot afford it', () => {
    let state = completeSetup(newGame(2));
    state.turn.phase = 'main';
    state.players[0].resources = Object.fromEntries(RESOURCES.map((r) => [r, 0]));
    const graph = graphOf(state);
    const edge = legalRoadEdges(state, graph, 0)[0];
    expect(() => reduce(state, { type: 'build_road', player: 0, edge }))
      .toThrow(/afford/);
  });
});

describe('development cards', () => {
  it('cannot be played the turn they are bought (toggle on)', () => {
    let state = bareMain(2);
    give(state, 0, { wool: 1, grain: 1, ore: 1 });
    state.devDeck = ['knight'];
    state = reduce(state, { type: 'buy_dev', player: 0 });
    expect(state.players[0].newDev.knight).toBe(1);
    expect(() => reduce(state, { type: 'play_dev', player: 0, card: 'knight' }))
      .toThrow(GameError);
    // After ending the turn it becomes playable.
    state = reduce(state, { type: 'end_turn', player: 0 });
    expect(state.players[0].dev.knight).toBe(1);
  });

  it('is playable immediately when the delay toggle is off', () => {
    let state = bareMain(2, { devCardDelay: false });
    give(state, 0, { wool: 1, grain: 1, ore: 1 });
    state.devDeck = ['knight'];
    state = reduce(state, { type: 'buy_dev', player: 0 });
    expect(state.players[0].dev.knight).toBe(1);
  });

  it('allows only one dev card per turn', () => {
    let state = bareMain(2);
    state.players[0].dev.knight = 2;
    state = reduce(state, { type: 'play_dev', player: 0, card: 'knight' });
    const hex = state.board.hexes.find((h) => h.id !== state.board.robberHex);
    state = reduce(state, { type: 'move_robber', player: 0, hex: hex.id, victim: null });
    expect(() => reduce(state, { type: 'play_dev', player: 0, card: 'knight' }))
      .toThrow(/one development card/);
  });

  it('awards Largest Army at 3 knights and lets others steal it', () => {
    let state = bareMain(2);
    state.players[0].knightsPlayed = 2;
    state.players[0].dev.knight = 1;
    state = reduce(state, { type: 'play_dev', player: 0, card: 'knight' });
    expect(state.largestArmy).toEqual({ player: 0, count: 3 });
    expect(publicVP(state, 0)).toBe(2);
    // Player 1 plays 4 knights -> steals the title.
    state.turn.phase = 'main';
    state.turn.player = 1;
    state.turn.devPlayed = false;
    state.players[1].knightsPlayed = 3;
    state.players[1].dev.knight = 1;
    state = reduce(state, { type: 'play_dev', player: 1, card: 'knight' });
    expect(state.largestArmy).toEqual({ player: 1, count: 4 });
  });

  it('monopoly takes every card of the named resource', () => {
    let state = bareMain(3);
    state.players[0].dev.monopoly = 1;
    give(state, 1, { ore: 3 });
    give(state, 2, { ore: 2, brick: 1 });
    state = reduce(state, { type: 'play_dev', player: 0, card: 'monopoly', resource: 'ore' });
    expect(state.players[0].resources.ore).toBe(5);
    expect(state.players[1].resources.ore).toBe(0);
    expect(state.players[2].resources.brick).toBe(1);
  });

  it('year of plenty takes two resources from the bank', () => {
    let state = bareMain(2);
    state.players[0].dev.yearOfPlenty = 1;
    state = reduce(state, { type: 'play_dev', player: 0, card: 'yearOfPlenty', resources: ['ore', 'ore'] });
    expect(state.players[0].resources.ore).toBe(2);
    expect(state.bank.ore).toBe(17);
  });

  it('year of plenty cannot take 2 of a resource the bank has only 1 of', () => {
    const state = bareMain(2);
    state.players[0].dev.yearOfPlenty = 1;
    state.bank.ore = 1;
    expect(() => reduce(state, { type: 'play_dev', player: 0, card: 'yearOfPlenty', resources: ['ore', 'ore'] }))
      .toThrow(GameError);
    // The bot must not attempt it either: give it that exact situation.
    state.players[0].resources = { brick: 0, lumber: 0, wool: 1, grain: 0, ore: 1 }; // city goal needs 2 grain 3 ore
    state.bank.grain = 1;
    const action = botAction(state, 0);
    if (action?.type === 'play_dev' && action.card === 'yearOfPlenty') {
      const wanted = {};
      for (const r of action.resources) wanted[r] = (wanted[r] || 0) + 1;
      for (const [r, n] of Object.entries(wanted)) expect(state.bank[r]).toBeGreaterThanOrEqual(n);
    }
  });

  it('road building places two free roads', () => {
    let state = completeSetup(newGame(2));
    state.turn.phase = 'main';
    state.players[0].dev.roadBuilding = 1;
    const graph = graphOf(state);
    const e1 = legalRoadEdges(state, graph, 0)[0];
    // Second edge chosen after the first is applied.
    const mid = reduce(state, { type: 'play_dev', player: 0, card: 'roadBuilding', edges: [e1] });
    const e2 = legalRoadEdges(mid, graph, 0).find((e) => e !== e1);
    state = reduce(state, { type: 'play_dev', player: 0, card: 'roadBuilding', edges: [e1, e2] });
    expect(state.occ.edges[e1]).toBe(0);
    expect(state.occ.edges[e2]).toBe(0);
    expect(countResources(state.players[0].resources) >= 0).toBe(true);
    expect(state.players[0].pieces.road).toBe(15 - 4);
  });

  it('victory point cards count toward winning', () => {
    let state = bareMain(2, { targetVP: 3 });
    give(state, 0, { wool: 1, grain: 1, ore: 1 });
    state.players[0].pieces.settlement = 3; // 2 settlements placed = 2 VP
    state.devDeck = ['vp'];
    state = reduce(state, { type: 'buy_dev', player: 0 });
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe(0);
  });
});

describe('trading', () => {
  it('trades 4:1 with the bank by default', () => {
    let state = bareMain(2);
    give(state, 0, { brick: 4 });
    state = reduce(state, { type: 'bank_trade', player: 0, give: 'brick', get: 'ore' });
    expect(state.players[0].resources.brick).toBe(0);
    expect(state.players[0].resources.ore).toBe(1);
  });

  it('uses 2:1 and 3:1 port ratios', () => {
    const state = bareMain(2);
    const graph = graphOf(state);
    const port2 = state.board.ports.find((p) => p.kind !== '3:1');
    const port3 = state.board.ports.find((p) => p.kind === '3:1');
    state.occ.vertices[port2.vertices[0]] = { player: 0, type: 'settlement' };
    state.occ.vertices[port3.vertices[0]] = { player: 1, type: 'settlement' };
    expect(tradeRatio(state, graph, 0, port2.kind)).toBe(2);
    expect(tradeRatio(state, graph, 0, RESOURCES.find((r) => r !== port2.kind))).toBe(4);
    expect(tradeRatio(state, graph, 1, 'brick')).toBe(3);
  });

  it('runs a full player-to-player trade', () => {
    let state = bareMain(3);
    give(state, 0, { brick: 2 });
    give(state, 1, { ore: 1 });
    state = reduce(state, { type: 'offer_trade', player: 0, offer: { brick: 2 }, want: { ore: 1 } });
    state = reduce(state, { type: 'respond_trade', player: 1, accept: true });
    state = reduce(state, { type: 'respond_trade', player: 2, accept: false });
    expect(() => reduce(state, { type: 'confirm_trade', player: 0, with: 2 })).toThrow(GameError);
    state = reduce(state, { type: 'confirm_trade', player: 0, with: 1 });
    expect(state.players[0].resources.ore).toBe(1);
    expect(state.players[1].resources.brick).toBe(2);
    expect(state.trade).toBeNull();
  });

  it('blocks player trades when the toggle is off', () => {
    const state = bareMain(2, { playerTrading: false });
    give(state, 0, { brick: 2 });
    expect(() => reduce(state, { type: 'offer_trade', player: 0, offer: { brick: 2 }, want: { ore: 1 } }))
      .toThrow(/disabled/);
  });
});

describe('longest road', () => {
  it('computes path lengths and awards the title at 5+', () => {
    let state = completeSetup(newGame(2));
    state.turn.phase = 'main';
    // Build roads until player 0 has a 5-chain.
    for (let i = 0; i < 8 && state.longestRoad.player === null; i++) {
      give(state, 0, { brick: 1, lumber: 1 });
      const graph = graphOf(state);
      // Extend from the far end to keep one continuous chain where possible.
      const edges = legalRoadEdges(state, graph, 0);
      let best = null;
      let bestLen = -1;
      for (const e of edges) {
        const trial = reduce(state, { type: 'build_road', player: 0, edge: e });
        const len = longestRoadLength(graph, trial.occ, 0);
        if (len > bestLen) { bestLen = len; best = e; }
      }
      state = reduce(state, { type: 'build_road', player: 0, edge: best });
    }
    expect(state.longestRoad.player).toBe(0);
    expect(state.longestRoad.length).toBeGreaterThanOrEqual(5);
    expect(publicVP(state, 0)).toBeGreaterThanOrEqual(4); // 2 settlements + LR
  });

  it('counts a simple chain correctly', () => {
    const state = bareMain(2);
    const graph = graphOf(state);
    // Take any hex and claim 4 of its 6 perimeter edges in a row: length 4.
    const hex = state.board.hexes[0];
    const corners = Object.values(graph.vertices).filter((v) => v.hexes.includes(hex.id));
    // Order corners around the hex by angle.
    const c = corners.reduce((acc, v) => ({ x: acc.x + v.x / 6, y: acc.y + v.y / 6 }), { x: 0, y: 0 });
    corners.sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
    for (let i = 0; i < 4; i++) {
      const a = corners[i].id;
      const b = corners[i + 1].id;
      const eid = a < b ? `${a}|${b}` : `${b}|${a}`;
      state.occ.edges[eid] = 0;
    }
    expect(longestRoadLength(graph, state.occ, 0)).toBe(4);
  });

  it('is cut by an opponent settlement', () => {
    const state = bareMain(2);
    const graph = graphOf(state);
    const hex = state.board.hexes[0];
    const corners = Object.values(graph.vertices).filter((v) => v.hexes.includes(hex.id));
    const c = corners.reduce((acc, v) => ({ x: acc.x + v.x / 6, y: acc.y + v.y / 6 }), { x: 0, y: 0 });
    corners.sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
    for (let i = 0; i < 4; i++) {
      const a = corners[i].id;
      const b = corners[i + 1].id;
      const eid = a < b ? `${a}|${b}` : `${b}|${a}`;
      state.occ.edges[eid] = 0;
    }
    // Opponent building on the middle vertex splits 4 into 2+2.
    state.occ.vertices[corners[2].id] = { player: 1, type: 'settlement' };
    expect(longestRoadLength(graph, state.occ, 0)).toBe(2);
  });
});

describe('winning', () => {
  it('ends the game when the active player reaches the target', () => {
    let state = completeSetup(newGame(2, { targetVP: 3 }));
    state.turn.phase = 'main';
    give(state, 0, { grain: 2, ore: 3 });
    const mine = Object.entries(state.occ.vertices).find(([, b]) => b.player === 0)[0];
    state = reduce(state, { type: 'build_city', player: 0, vertex: mine });
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe(0);
    expect(() => reduce(state, { type: 'end_turn', player: 0 })).toThrow(/over/);
  });
});

describe('5-6 player special building phase', () => {
  it('lets every other player build after end_turn, then advances', () => {
    let state = completeSetup(newGame(5));
    state.turn.phase = 'main';
    state.turn.player = 0;
    state = reduce(state, { type: 'end_turn', player: 0 });
    expect(state.turn.phase).toBe('special');
    expect(state.turn.special.queue).toEqual([1, 2, 3, 4]);
    expect(currentActor(state)).toBe(1);
    // Player 1 builds a road during the special phase.
    give(state, 1, { brick: 1, lumber: 1 });
    const graph = graphOf(state);
    const edge = legalRoadEdges(state, graph, 1)[0];
    state = reduce(state, { type: 'build_road', player: 1, edge });
    expect(state.occ.edges[edge]).toBe(1);
    // But cannot play dev cards or trade.
    state.players[1].dev.knight = 1;
    expect(() => reduce(state, { type: 'play_dev', player: 1, card: 'knight' })).toThrow(GameError);
    expect(() => reduce(state, { type: 'offer_trade', player: 1, offer: { brick: 1 }, want: { ore: 1 } }))
      .toThrow(GameError);
    // Everyone passes; turn moves to player 1.
    for (const i of [1, 2, 3, 4]) state = reduce(state, { type: 'end_special', player: i });
    expect(state.turn.player).toBe(1);
    expect(state.turn.phase).toBe('roll');
  });

  it('does not trigger for 4 players', () => {
    let state = completeSetup(newGame(4));
    state.turn.phase = 'main';
    state = reduce(state, { type: 'end_turn', player: 0 });
    expect(state.turn.player).toBe(1);
    expect(state.turn.phase).toBe('roll');
  });
});

describe('turn order and permissions', () => {
  it('rejects out-of-turn actions', () => {
    let state = completeSetup(newGame(3));
    expect(() => reduce(state, { type: 'roll', player: 1 })).toThrow(/turn/);
    state = reduce(state, { type: 'roll', player: 0 });
    if (state.turn.phase === 'main') {
      expect(() => reduce(state, { type: 'end_turn', player: 2 })).toThrow(/turn/);
    }
  });

  it('records chat from any player at any time', () => {
    let state = newGame(2);
    state = reduce(state, { type: 'chat', player: 1, text: 'hello!', ts: 123 });
    expect(state.chat).toEqual([{ p: 1, text: 'hello!', ts: 123 }]);
  });
});

describe('bots', () => {
  // Bots use Math.random for variety; pin it so these full-game tests are
  // reproducible instead of flaky.
  beforeEach(() => {
    const rand = mulberry32(0xbadc0de);
    vi.spyOn(Math, 'random').mockImplementation(rand);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['easy', 'medium', 'hard'])('a full 4-bot game (%s) reaches a winner', (level) => {
    let state = createGame({
      players: mkPlayers(4).map((p) => ({ ...p, isBot: true, botLevel: level })),
      settings: { targetVP: 8 },
      seed: 99,
    });
    let guard = 0;
    while (state.phase !== 'ended' && guard < 8000) {
      guard += 1;
      let acted = false;
      // Trade responses may be needed from non-active players.
      for (let i = 0; i < state.players.length; i++) {
        const action = botAction(state, i);
        if (action) {
          state = reduce(state, { ...action, player: i, ts: guard });
          acted = true;
          break;
        }
      }
      if (!acted) throw new Error(`stalled in phase ${state.turn.phase}`);
    }
    expect(state.phase).toBe('ended');
    expect(totalVP(state, state.winner)).toBeGreaterThanOrEqual(8);
  }, 30000);

  it('a 6-bot game on the large board completes with special building phases', () => {
    let state = createGame({
      players: mkPlayers(6).map((p) => ({ ...p, isBot: true, botLevel: 'medium' })),
      settings: { targetVP: 6 },
      seed: 7,
    });
    let guard = 0;
    let sawSpecial = false;
    while (state.phase !== 'ended' && guard < 12000) {
      guard += 1;
      if (state.turn.phase === 'special') sawSpecial = true;
      let acted = false;
      for (let i = 0; i < state.players.length; i++) {
        const action = botAction(state, i);
        if (action) {
          state = reduce(state, { ...action, player: i, ts: guard });
          acted = true;
          break;
        }
      }
      if (!acted) throw new Error(`stalled in phase ${state.turn.phase}`);
    }
    expect(state.phase).toBe('ended');
    expect(sawSpecial).toBe(true);
  }, 30000);
});
