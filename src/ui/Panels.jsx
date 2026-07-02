// Sidebar panels: player summaries, the local player's hand, build actions,
// and the tabbed event log / chat.

import { useEffect, useRef, useState } from 'react';
import { RESOURCES, COSTS, PLAYER_COLORS } from '../engine/constants.js';
import {
  publicVP, countResources, hasResources, graphOf,
  legalCityVertices, legalSettlementVertices, legalRoadEdges,
} from '../engine/game.js';
import { longestRoadLength } from '../engine/longestRoad.js';

export const RES_COLORS = {
  brick: '#c4653f',
  lumber: '#3e7c4f',
  wool: '#7fa85a',
  grain: '#cfa63e',
  ore: '#8a8f9c',
};
export const RES_LABELS = { brick: 'Brick', lumber: 'Lumber', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
const DEV_LABELS = {
  knight: 'Knight',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
  vp: 'Victory Point',
};

export function ResChip({ res, n }) {
  return (
    <span className="res-chip" style={{ background: RES_COLORS[res] }} title={RES_LABELS[res]}>
      {RES_LABELS[res][0]} {n}
    </span>
  );
}

export function PlayersPanel({ state, myIndex, presence, mode }) {
  const graph = graphOf(state);
  return (
    <div className="card players">
      {state.players.map((p, i) => {
        const active = state.phase !== 'ended' && state.turn.player === i;
        const roadLen = longestRoadLength(graph, state.occ, i);
        const offline = mode === 'online' && !p.isBot && presence && !presence[p.id];
        return (
          <div key={p.id} className={`player-row ${active ? 'active' : ''} ${offline ? 'offline' : ''}`}>
            <span className="dot" style={{ background: PLAYER_COLORS[i] }} />
            <span className="name">
              {p.name}{p.isBot ? ' 🤖' : ''}{i === myIndex ? ' (you)' : ''}
            </span>
            {state.longestRoad.player === i && <span className="badge">Road {state.longestRoad.length}</span>}
            {state.largestArmy.player === i && <span className="badge army">Army {state.largestArmy.count}</span>}
            <span className="stat" title="resource cards / dev cards / knights played">
              🂠{countResources(p.resources)} ✦{Object.values(p.dev).reduce((a, b) => a + b, 0) + Object.values(p.newDev).reduce((a, b) => a + b, 0)} ⚔{p.knightsPlayed}
            </span>
            <span className="stat" title="longest own road">{roadLen}🛤</span>
            <span className="vp">{publicVP(state, i)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function HandPanel({ state, myIndex, canPlayDev, onPlayDev }) {
  if (myIndex < 0) return null;
  const p = state.players[myIndex];
  const newTotal = Object.values(p.newDev).reduce((a, b) => a + b, 0);
  return (
    <div className="card hand">
      <div className="res-row">
        {RESOURCES.map((r) => <ResChip key={r} res={r} n={p.resources[r]} />)}
      </div>
      <div className="dev-row">
        {Object.entries(p.dev).map(([card, n]) => n > 0 && (
          <button
            key={card}
            className="btn small"
            disabled={card === 'vp' || !canPlayDev}
            onClick={() => onPlayDev(card)}
            title={card === 'vp' ? 'Victory point cards count automatically' : `Play ${DEV_LABELS[card]}`}
          >
            {DEV_LABELS[card]} ×{n}
          </button>
        ))}
        {newTotal > 0 && <span className="badge" title="Bought this turn — playable next turn">+{newTotal} new</span>}
      </div>
    </div>
  );
}

export function ActionsPanel({ state, myIndex, canBuild, canAct, onMode, onBuyDev, onTrade, onBankTrade, onEndTurn, special }) {
  const p = state.players[myIndex];
  if (!p) return null;
  const graph = graphOf(state);
  const afford = (what) => hasResources(p.resources, COSTS[what]);
  const roadOk = canBuild && afford('road') && p.pieces.road > 0 && legalRoadEdges(state, graph, myIndex).length > 0;
  const settOk = canBuild && afford('settlement') && p.pieces.settlement > 0
    && legalSettlementVertices(state, graph, myIndex).length > 0;
  const cityOk = canBuild && afford('city') && p.pieces.city > 0 && legalCityVertices(state, myIndex).length > 0;
  const devOk = canBuild && afford('devCard') && state.devDeck.length > 0;
  return (
    <div className="card actions">
      <button className="btn" disabled={!roadOk} onClick={() => onMode('road')}>
        Road <span className="cost">🧱+🪵 · {p.pieces.road} left</span>
      </button>
      <button className="btn" disabled={!settOk} onClick={() => onMode('settlement')}>
        Settlement <span className="cost">🧱🪵🐑🌾 · {p.pieces.settlement} left</span>
      </button>
      <button className="btn" disabled={!cityOk} onClick={() => onMode('city')}>
        City <span className="cost">🌾×2 ⛏×3 · {p.pieces.city} left</span>
      </button>
      <button className="btn" disabled={!devOk} onClick={onBuyDev}>
        Dev card <span className="cost">🐑🌾⛏ · {state.devDeck.length} left</span>
      </button>
      {!special && (
        <>
          <button className="btn" disabled={!canAct || !state.settings.playerTrading} onClick={onTrade}>
            Trade players
          </button>
          <button className="btn" disabled={!canAct} onClick={onBankTrade}>
            Trade bank
          </button>
        </>
      )}
      <button className="btn primary wide" disabled={!canAct && !special} onClick={onEndTurn}>
        {special ? 'Done building' : 'End turn'}
      </button>
    </div>
  );
}

function logText(entry, state) {
  const name = (i) => state.players[i]?.name ?? '?';
  switch (entry.t) {
    case 'start': return 'Game started — place your settlements!';
    case 'main-start': return 'Setup complete. Let the game begin!';
    case 'roll': return { who: entry.p, text: `rolled`, dice: entry.dice };
    case 'gain': {
      const parts = Object.entries(entry.gained || {}).map(([i, res]) => {
        const items = Object.entries(res).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${r}`).join(', ');
        return items ? `${name(i)} +${items}` : null;
      }).filter(Boolean);
      return parts.length ? parts.join(' · ') : 'No one collected resources.';
    }
    case 'road': return { who: entry.p, text: 'built a road' };
    case 'settlement': return { who: entry.p, text: 'built a settlement' };
    case 'city': return { who: entry.p, text: 'upgraded to a city' };
    case 'buy-dev': return { who: entry.p, text: 'bought a development card' };
    case 'dev': return { who: entry.p, text: `played ${DEV_LABELS[entry.card] || entry.card}` };
    case 'monopoly': return { who: entry.p, text: `monopolized ${entry.resource} (+${entry.taken})` };
    case 'robber': return {
      who: entry.p,
      text: entry.victim != null ? `moved the robber and robbed ${name(entry.victim)}` : 'moved the robber',
    };
    case 'discard-start': return 'A 7! Players with 8+ cards must discard half.';
    case 'discarded': return { who: entry.p, text: `discarded ${entry.count} cards` };
    case 'bank-trade': return { who: entry.p, text: `traded ${entry.ratio} ${entry.give} → 1 ${entry.get}` };
    case 'trade-offer': return { who: entry.p, text: 'proposed a trade' };
    case 'trade': return { who: entry.p, text: `traded with ${name(entry.with)}` };
    case 'special-start': return 'Special building phase — everyone may build.';
    case 'turn': return { who: entry.p, text: 'is up' };
    case 'win': return { who: entry.p, text: `wins with ${entry.vp} victory points! 🎉` };
    default: return null;
  }
}

export function LogPanel({ state }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [state.log.length]);
  return (
    <div className="log" ref={ref}>
      {state.log.map((entry, i) => {
        const line = logText(entry, state);
        if (!line) return null;
        if (typeof line === 'string') return <div key={i} className="entry">{line}</div>;
        return (
          <div key={i} className="entry">
            <b style={{ color: PLAYER_COLORS[line.who] }}>{state.players[line.who]?.name}</b>{' '}
            {line.text}
            {line.dice && <span className="dice-pair"> ⚀ {line.dice[0]} + {line.dice[1]} = {line.dice[0] + line.dice[1]}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function ChatPanel({ state, onSend, myName }) {
  const [text, setText] = useState('');
  const ref = useRef(null);
  const messages = state.chat || [];
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [messages.length]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };
  return (
    <>
      <div className="chat-list" ref={ref}>
        {messages.map((m, i) => (
          <div key={i} className="chat-row">
            <span className="who" style={{ color: m.p != null ? PLAYER_COLORS[m.p] : 'inherit' }}>
              {m.p != null ? state.players[m.p]?.name : m.name}:
            </span>
            <span>{m.text}</span>
          </div>
        ))}
        {messages.length === 0 && <div className="entry" style={{ color: 'var(--ink-soft)' }}>Say hi 👋</div>}
      </div>
      <div className="chat-input">
        <input
          value={text}
          placeholder={`Chat as ${myName || 'you'}…`}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn small" onClick={send}>Send</button>
      </div>
    </>
  );
}
