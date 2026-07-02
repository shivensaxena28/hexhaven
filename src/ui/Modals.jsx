// Dialogs: trading, discarding, robber victims, resource pickers, winner.

import { useMemo, useState } from 'react';
import { RESOURCES, PLAYER_COLORS } from '../engine/constants.js';
import { totalVP, publicVP, countResources, tradeRatio, graphOf, hasResources } from '../engine/game.js';
import { ResChip, RES_LABELS } from './Panels.jsx';

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

function ResourceCounter({ counts, setCounts, max }) {
  return (
    <>
      {RESOURCES.map((r) => (
        <div className="counter" key={r}>
          <button onClick={() => setCounts({ ...counts, [r]: Math.max(0, (counts[r] || 0) - 1) })}>−</button>
          <span className="n">{counts[r] || 0}</span>
          <button
            onClick={() => setCounts({ ...counts, [r]: Math.min(max?.[r] ?? 19, (counts[r] || 0) + 1) })}
          >
            +
          </button>
          <ResChip res={r} n={max ? `${max[r]}` : ''} />
        </div>
      ))}
    </>
  );
}

export function TradeModal({ state, myIndex, onOffer, onClose }) {
  const [offer, setOffer] = useState({});
  const [want, setWant] = useState({});
  const mine = state.players[myIndex].resources;
  const offerTotal = countResources(offer);
  const wantTotal = countResources(want);
  return (
    <Modal title="Propose a trade" onClose={onClose}>
      <div className="trade-grid">
        <div className="trade-col">
          <h4>You give</h4>
          <ResourceCounter counts={offer} setCounts={setOffer} max={mine} />
        </div>
        <div className="trade-col">
          <h4>You want</h4>
          <ResourceCounter counts={want} setCounts={setWant} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={offerTotal === 0 || wantTotal === 0}
          onClick={() => { onOffer(offer, want); onClose(); }}
        >
          Offer to everyone
        </button>
      </div>
    </Modal>
  );
}

export function BankTradeModal({ state, myIndex, onTrade, onClose }) {
  const graph = useMemo(() => graphOf(state), [state]);
  const p = state.players[myIndex];
  const [give, setGive] = useState(null);
  const ratio = give ? tradeRatio(state, graph, myIndex, give) : null;
  return (
    <Modal title="Trade with the bank" onClose={onClose}>
      <h4 style={{ margin: '0 0 0.4rem', color: 'var(--ink-soft)' }}>Give</h4>
      <div className="res-row" style={{ marginBottom: '0.9rem' }}>
        {RESOURCES.map((r) => {
          const rr = tradeRatio(state, graph, myIndex, r);
          return (
            <button
              key={r}
              className="btn small"
              disabled={p.resources[r] < rr}
              style={give === r ? { outline: '2px solid var(--accent)' } : {}}
              onClick={() => setGive(r)}
            >
              {rr}× {RES_LABELS[r]}
            </button>
          );
        })}
      </div>
      <h4 style={{ margin: '0 0 0.4rem', color: 'var(--ink-soft)' }}>Receive 1</h4>
      <div className="res-row">
        {RESOURCES.map((r) => (
          <button
            key={r}
            className="btn small"
            disabled={!give || r === give || state.bank[r] < 1}
            onClick={() => { onTrade(give, r); onClose(); }}
          >
            {RES_LABELS[r]}
          </button>
        ))}
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
        {give ? `Your rate for ${RES_LABELS[give]} is ${ratio}:1.` : 'Ports you have settled improve your rate to 3:1 or 2:1.'}
      </p>
    </Modal>
  );
}

export function OfferBanner({ state, myIndex, onRespond, onConfirm, onCancel }) {
  const trade = state.trade;
  if (!trade) return null;
  const fromMe = trade.from === myIndex;
  const myResponse = trade.responses[myIndex];
  const offerStr = Object.entries(trade.offer).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${r}`).join(', ');
  const wantStr = Object.entries(trade.want).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${r}`).join(', ');
  const canAfford = myIndex >= 0 && hasResources(state.players[myIndex].resources, trade.want);
  return (
    <div className="offer-banner">
      <div className="row">
        <b style={{ color: PLAYER_COLORS[trade.from] }}>{state.players[trade.from].name}</b>
        offers <b>{offerStr}</b> for <b>{wantStr}</b>
      </div>
      {fromMe ? (
        <div className="respondents">
          {state.players.map((p, i) => {
            if (i === myIndex) return null;
            const r = trade.responses[i];
            return (
              <div className="row" key={p.id}>
                <span className="dot" style={{ background: PLAYER_COLORS[i], width: 10, height: 10, borderRadius: '50%' }} />
                <span style={{ flex: 1 }}>{p.name}</span>
                {r === 'accepted' && <button className="btn small primary" onClick={() => onConfirm(i)}>Trade!</button>}
                {r === 'declined' && <span style={{ color: 'var(--ink-soft)' }}>declined</span>}
                {r === undefined && <span style={{ color: 'var(--ink-soft)' }}>thinking…</span>}
              </div>
            );
          })}
          <div className="row">
            <button className="btn small danger" onClick={onCancel}>Withdraw offer</button>
          </div>
        </div>
      ) : myResponse === undefined ? (
        <div className="row">
          <button className="btn small primary" disabled={!canAfford} onClick={() => onRespond(true)}>
            Accept
          </button>
          <button className="btn small" onClick={() => onRespond(false)}>Decline</button>
          {!canAfford && <span style={{ color: 'var(--ink-soft)' }}>you can't afford it</span>}
        </div>
      ) : (
        <div className="row" style={{ color: 'var(--ink-soft)' }}>
          You {myResponse}. Waiting for {state.players[trade.from].name}…
        </div>
      )}
    </div>
  );
}

export function DiscardModal({ state, playerIndex, onDiscard }) {
  const owed = state.turn.pendingDiscards?.[playerIndex] || 0;
  const [picked, setPicked] = useState({});
  const p = state.players[playerIndex];
  const total = countResources(picked);
  return (
    <Modal title={`Discard ${owed} cards`}>
      <p style={{ marginTop: 0, color: 'var(--ink-soft)' }}>
        A 7 was rolled and you hold too many cards. Choose {owed} to return to the bank.
      </p>
      <ResourceCounter counts={picked} setCounts={setPicked} max={p.resources} />
      <button
        className="btn primary"
        style={{ width: '100%', marginTop: '0.8rem' }}
        disabled={total !== owed}
        onClick={() => onDiscard(picked)}
      >
        Discard {total}/{owed}
      </button>
    </Modal>
  );
}

export function VictimModal({ state, victims, onPick, onClose }) {
  return (
    <Modal title="Steal from…" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {victims.map((i) => (
          <button key={i} className="btn" onClick={() => onPick(i)}>
            <span className="dot" style={{ background: PLAYER_COLORS[i], display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 8 }} />
            {state.players[i].name} — {countResources(state.players[i].resources)} cards, {publicVP(state, i)} VP
          </button>
        ))}
      </div>
    </Modal>
  );
}

// Pick `count` resources (Year of Plenty: 2 from bank, Monopoly: 1 named).
export function ResourcePickerModal({ title, subtitle, count, fromBank, state, onPick, onClose }) {
  const [picks, setPicks] = useState([]);
  const toggle = (r) => {
    if (picks.length < count) setPicks([...picks, r]);
  };
  return (
    <Modal title={title} onClose={onClose}>
      {subtitle && <p style={{ marginTop: 0, color: 'var(--ink-soft)' }}>{subtitle}</p>}
      <div className="res-row">
        {RESOURCES.map((r) => (
          <button
            key={r}
            className="btn small"
            disabled={fromBank && state.bank[r] < 1 + picks.filter((x) => x === r).length}
            onClick={() => toggle(r)}
          >
            {RES_LABELS[r]}
          </button>
        ))}
      </div>
      <p style={{ minHeight: '1.2em' }}>{picks.map((r) => RES_LABELS[r]).join(' + ')}</p>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => setPicks([])}>Reset</button>
        <button className="btn primary" disabled={picks.length !== count} onClick={() => onPick(picks)}>
          Confirm
        </button>
      </div>
    </Modal>
  );
}

export function WinnerOverlay({ state, onRematch, onHome, canRematch }) {
  const ranked = state.players
    .map((p, i) => ({ p, i, vp: totalVP(state, i) }))
    .sort((a, b) => b.vp - a.vp);
  return (
    <div className="winner-overlay">
      <div className="card winner-card">
        <div style={{ fontSize: '2.4rem' }}>🏆</div>
        <h2>{state.players[state.winner].name} wins!</h2>
        <ul className="standings">
          {ranked.map(({ p, i, vp }) => (
            <li key={p.id}>
              <span className="dot" style={{ background: PLAYER_COLORS[i], width: 12, height: 12, borderRadius: '50%' }} />
              <span style={{ flex: 1 }}>{p.name}</span>
              <b>{vp} VP</b>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center' }}>
          {canRematch && <button className="btn primary" onClick={onRematch}>Rematch</button>}
          <button className="btn" onClick={onHome}>Back to home</button>
        </div>
      </div>
    </div>
  );
}
