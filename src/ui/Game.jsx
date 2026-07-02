// The in-game screen: board + sidebar, placement modes, dialogs, sounds,
// the optional turn timer, and the host-disconnect pause overlay.

import { useEffect, useMemo, useRef, useState } from 'react';
import Board from './Board.jsx';
import {
  PlayersPanel, HandPanel, ActionsPanel, LogPanel, ChatPanel,
} from './Panels.jsx';
import {
  TradeModal, BankTradeModal, OfferBanner, DiscardModal, VictimModal,
  ResourcePickerModal, WinnerOverlay,
} from './Modals.jsx';
import {
  graphOf, currentActor, legalSettlementVertices, legalRoadEdges,
  legalCityVertices, legalRobberHexes, robberVictims,
} from '../engine/game.js';
import { PLAYER_COLORS } from '../engine/constants.js';
import { soundForLog, isMuted, setMuted, sounds } from './sounds.js';

export default function Game({ session, state, onExit }) {
  const [mode, setMode] = useState(null); // null | 'road' | 'settlement' | 'city' | {type:'roadBuilding', edges:[]}
  const [tab, setTab] = useState('log');
  const [tradeOpen, setTradeOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [picker, setPicker] = useState(null); // {card:'yearOfPlenty'|'monopoly'}
  const [victimPick, setVictimPick] = useState(null); // {hex, victims}
  const [toast, setToast] = useState(null);
  const [muted, setMutedState] = useState(isMuted());
  const [, forceTick] = useState(0);

  const graph = useMemo(() => graphOf(state), [state.board.hexes]);
  const actor = currentActor(state);
  const local = session.mode === 'local';

  // Whose eyes are we looking through? Online: my fixed seat. Hot-seat: the
  // human whose move it is (bots play themselves).
  const myIndex = local
    ? (actor != null && !state.players[actor].isBot ? actor : -1)
    : session.myIndex;
  const iAct = myIndex >= 0 && actor === myIndex;
  const t = state.turn;

  const dispatch = (action) => session.dispatch(local ? { ...action, player: myIndex } : action);

  // ---- sounds for new log entries ----
  const lastLog = useRef(state.log.length);
  useEffect(() => {
    for (let i = lastLog.current; i < state.log.length; i++) soundForLog(state.log[i]);
    lastLog.current = state.log.length;
  }, [state.log.length]);
  const lastChat = useRef(state.chat?.length || 0);
  useEffect(() => {
    const n = state.chat?.length || 0;
    if (n > lastChat.current) sounds.chat();
    lastChat.current = n;
  }, [state.chat?.length]);

  // ---- error toasts ----
  const lastErr = useRef(session.errorSeq);
  useEffect(() => {
    const check = () => {
      if (session.errorSeq !== lastErr.current) {
        lastErr.current = session.errorSeq;
        setToast(session.error);
        setTimeout(() => setToast(null), 3500);
      }
    };
    return session.subscribe(check);
  }, [session]);

  // ---- countdown ticks while a deadline is set ----
  useEffect(() => {
    if (!t.deadline) return undefined;
    const iv = setInterval(() => forceTick((x) => x + 1), 500);
    return () => clearInterval(iv);
  }, [t.deadline]);

  // ---- reset transient UI when the turn moves on ----
  useEffect(() => {
    setMode(null);
    setVictimPick(null);
  }, [actor, t.phase]);

  // ---- board interactivity ----
  let highlightVertices = null;
  let highlightEdges = null;
  let highlightHexes = null;

  if (state.phase === 'setup' && iAct) {
    if (state.setup.sub === 'settlement') {
      highlightVertices = new Set(legalSettlementVertices(state, graph, myIndex));
    } else {
      highlightEdges = new Set(legalRoadEdges(state, graph, myIndex));
    }
  } else if (state.phase === 'main' && t.phase === 'robber' && iAct && !victimPick) {
    highlightHexes = new Set(legalRobberHexes(state));
  } else if (mode && myIndex >= 0) {
    if (mode === 'settlement') highlightVertices = new Set(legalSettlementVertices(state, graph, myIndex));
    else if (mode === 'city') highlightVertices = new Set(legalCityVertices(state, myIndex));
    else if (mode === 'road') highlightEdges = new Set(legalRoadEdges(state, graph, myIndex));
    else if (mode.type === 'roadBuilding') {
      // Preview legality with already-picked edges applied.
      const trial = structuredClone(state);
      for (const e of mode.edges) trial.occ.edges[e] = myIndex;
      highlightEdges = new Set(legalRoadEdges(trial, graph, myIndex).filter((e) => !mode.edges.includes(e)));
    }
  }

  const onVertexClick = (vid) => {
    if (state.phase === 'setup') dispatch({ type: 'place_settlement', vertex: vid });
    else if (mode === 'settlement') dispatch({ type: 'build_settlement', vertex: vid });
    else if (mode === 'city') dispatch({ type: 'build_city', vertex: vid });
    setMode(null);
  };
  const onEdgeClick = (eid) => {
    if (state.phase === 'setup') {
      dispatch({ type: 'place_road', edge: eid });
    } else if (mode === 'road') {
      dispatch({ type: 'build_road', edge: eid });
      setMode(null);
    } else if (mode?.type === 'roadBuilding') {
      const edges = [...mode.edges, eid];
      const p = state.players[myIndex];
      const wanted = Math.min(2, p.pieces.road);
      const trial = structuredClone(state);
      for (const e of edges) trial.occ.edges[e] = myIndex;
      const more = legalRoadEdges(trial, graph, myIndex).length > 0;
      if (edges.length >= wanted || !more) {
        dispatch({ type: 'play_dev', card: 'roadBuilding', edges });
        setMode(null);
      } else {
        setMode({ type: 'roadBuilding', edges });
      }
    }
  };
  const onHexClick = (hexId) => {
    const victims = robberVictims(state, graph, hexId, myIndex);
    if (victims.length === 0) dispatch({ type: 'move_robber', hex: hexId, victim: null });
    else if (victims.length === 1) dispatch({ type: 'move_robber', hex: hexId, victim: victims[0] });
    else setVictimPick({ hex: hexId, victims });
  };

  const onPlayDev = (card) => {
    if (card === 'knight') dispatch({ type: 'play_dev', card: 'knight' });
    else if (card === 'roadBuilding') setMode({ type: 'roadBuilding', edges: [] });
    else setPicker({ card });
  };

  // ---- discard: whose modal? ----
  let discardFor = null;
  if (t.phase === 'discard' && t.pendingDiscards) {
    if (!local && t.pendingDiscards[session.myIndex] != null) discardFor = session.myIndex;
    if (local) {
      const idx = Object.keys(t.pendingDiscards).map(Number).find((i) => !state.players[i].isBot);
      if (idx !== undefined) discardFor = idx;
    }
  }

  // ---- trade banner perspective (hot-seat: first human who hasn't answered) ----
  let tradeSeat = myIndex;
  if (local && state.trade) {
    if (state.players[state.trade.from].isBot) {
      tradeSeat = state.players.findIndex((p, i) => !p.isBot && i !== state.trade.from && state.trade.responses[i] === undefined);
    } else {
      const unanswered = state.players.findIndex((p, i) => !p.isBot && i !== state.trade.from && state.trade.responses[i] === undefined);
      tradeSeat = unanswered >= 0 ? unanswered : state.trade.from;
    }
  }

  // ---- phase hint ----
  const activeName = state.players[t.player]?.name;
  const specialActor = t.phase === 'special' ? t.special.queue[t.special.i] : null;
  let hint = '';
  if (state.phase === 'setup') {
    hint = iAct
      ? `Place a ${state.setup.sub === 'settlement' ? 'settlement' : 'road'}`
      : `${state.players[actor]?.name} is placing…`;
  } else if (t.phase === 'roll') hint = iAct ? 'Roll the dice!' : `${activeName} is rolling…`;
  else if (t.phase === 'discard') hint = 'Waiting for discards…';
  else if (t.phase === 'robber') hint = iAct ? 'Move the robber' : `${activeName} moves the robber…`;
  else if (t.phase === 'special') hint = `Special building: ${state.players[specialActor]?.name}`;
  else if (t.phase === 'main') hint = iAct ? 'Trade and build' : `${activeName} is playing…`;

  const secondsLeft = t.deadline ? Math.max(0, Math.ceil((t.deadline - Date.now()) / 1000)) : null;
  const canBuild = state.phase === 'main'
    && ((t.phase === 'main' && iAct) || (t.phase === 'special' && specialActor === myIndex));
  const canAct = state.phase === 'main' && t.phase === 'main' && iAct;
  const inSpecial = t.phase === 'special' && specialActor === myIndex;
  const paused = !local && state.phase !== 'lobby' && !session.isHost && !session.hostConnected();

  return (
    <div className="game">
      <div className="topbar">
        <button className="btn small" onClick={onExit}>← Leave</button>
        {session.code && (
          <button
            className="btn small"
            title="Copy invite code"
            onClick={() => { navigator.clipboard?.writeText(session.code); setToast('Code copied!'); setTimeout(() => setToast(null), 1500); }}
          >
            {session.code}
          </button>
        )}
        <div className="turn-banner">
          <span className="dot" style={{ background: PLAYER_COLORS[t.phase === 'special' ? specialActor : t.player] }} />
          <span>{t.phase === 'special' ? state.players[specialActor]?.name : activeName}</span>
          {t.dice && state.phase === 'main' && (
            <span className="dice-pair">🎲 {t.dice[0]}+{t.dice[1]}={t.dice[0] + t.dice[1]}</span>
          )}
          <span className="hint">{hint}</span>
          {iAct && t.phase === 'roll' && (
            <button className="btn small primary" onClick={() => dispatch({ type: 'roll' })}>Roll 🎲</button>
          )}
          {mode && (
            <button className="btn small danger" onClick={() => setMode(null)}>
              Cancel {typeof mode === 'string' ? mode : 'roads'}
            </button>
          )}
        </div>
        {secondsLeft != null && (
          <span className={`timer-chip ${secondsLeft <= 10 ? 'low' : ''}`}>{secondsLeft}s</span>
        )}
        <button
          className="btn small"
          title={muted ? 'Unmute sounds' : 'Mute sounds'}
          onClick={() => { setMuted(!muted); setMutedState(!muted); }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="board-wrap">
        <Board
          state={state}
          highlightVertices={highlightVertices}
          highlightEdges={highlightEdges}
          highlightHexes={highlightHexes}
          onVertexClick={onVertexClick}
          onEdgeClick={onEdgeClick}
          onHexClick={onHexClick}
        />
        {paused && (
          <div className="pause-overlay">
            Host disconnected — game paused.<br />
            Waiting for the host to return or for a new host to take over…
          </div>
        )}
      </div>

      <div className="sidebar">
        {state.trade && tradeSeat >= 0 && (
          <OfferBanner
            state={state}
            myIndex={tradeSeat}
            onRespond={(accept) => session.dispatch({ type: 'respond_trade', accept, ...(local ? { player: tradeSeat } : {}) })}
            onConfirm={(withIdx) => session.dispatch({ type: 'confirm_trade', with: withIdx, ...(local ? { player: state.trade.from } : {}) })}
            onCancel={() => session.dispatch({ type: 'cancel_trade', ...(local ? { player: state.trade.from } : {}) })}
          />
        )}
        <PlayersPanel state={state} myIndex={myIndex} presence={session.presence} mode={session.mode} />
        {myIndex >= 0 && (
          <HandPanel
            state={state}
            myIndex={myIndex}
            canPlayDev={iAct && (t.phase === 'main' || t.phase === 'roll') && !t.devPlayed && state.phase === 'main'}
            onPlayDev={onPlayDev}
          />
        )}
        {myIndex >= 0 && state.phase === 'main' && (canBuild || canAct) && (
          <ActionsPanel
            state={state}
            myIndex={myIndex}
            canBuild={canBuild}
            canAct={canAct}
            special={inSpecial}
            onMode={(m) => setMode(mode === m ? null : m)}
            onBuyDev={() => dispatch({ type: 'buy_dev' })}
            onTrade={() => setTradeOpen(true)}
            onBankTrade={() => setBankOpen(true)}
            onEndTurn={() => dispatch({ type: inSpecial ? 'end_special' : 'end_turn' })}
          />
        )}
        <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="tabs">
            <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Log</button>
            <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
              Chat{state.chat?.length ? ` (${state.chat.length})` : ''}
            </button>
          </div>
          {tab === 'log'
            ? <LogPanel state={state} />
            : (
              <ChatPanel
                state={state}
                myName={state.players[myIndex]?.name}
                onSend={(text) => dispatch({ type: 'chat', text })}
              />
            )}
        </div>
      </div>

      {tradeOpen && (
        <TradeModal
          state={state}
          myIndex={myIndex}
          onOffer={(offer, want) => dispatch({ type: 'offer_trade', offer, want })}
          onClose={() => setTradeOpen(false)}
        />
      )}
      {bankOpen && (
        <BankTradeModal
          state={state}
          myIndex={myIndex}
          onTrade={(give, get) => dispatch({ type: 'bank_trade', give, get })}
          onClose={() => setBankOpen(false)}
        />
      )}
      {discardFor != null && (
        <DiscardModal
          key={`${discardFor}-${state.v}`}
          state={state}
          playerIndex={discardFor}
          onDiscard={(res) => session.dispatch({ type: 'discard', resources: res, ...(local ? { player: discardFor } : {}) })}
        />
      )}
      {victimPick && (
        <VictimModal
          state={state}
          victims={victimPick.victims}
          onPick={(v) => { dispatch({ type: 'move_robber', hex: victimPick.hex, victim: v }); setVictimPick(null); }}
        />
      )}
      {picker?.card === 'yearOfPlenty' && (
        <ResourcePickerModal
          title="Year of Plenty"
          subtitle="Take any two resources from the bank."
          count={2}
          fromBank
          state={state}
          onPick={(picks) => { dispatch({ type: 'play_dev', card: 'yearOfPlenty', resources: picks }); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.card === 'monopoly' && (
        <ResourcePickerModal
          title="Monopoly"
          subtitle="Name a resource — every player must give you all of theirs."
          count={1}
          state={state}
          onPick={(picks) => { dispatch({ type: 'play_dev', card: 'monopoly', resource: picks[0] }); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
      {state.phase === 'ended' && (
        <WinnerOverlay
          state={state}
          canRematch={local || session.isHost}
          onRematch={() => session.rematch()}
          onHome={onExit}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
