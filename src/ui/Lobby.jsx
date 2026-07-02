// The online lobby: share the code, manage seats and bots, tune settings,
// chat while waiting, and (as host) start the game.

import { useState } from 'react';
import SettingsForm from './SettingsForm.jsx';
import { ChatPanel } from './Panels.jsx';

export default function Lobby({ session, state, onExit }) {
  const [copied, setCopied] = useState(false);
  const isHost = session.isHost;
  const me = state.players.find((p) => p.id === session.playerId);
  const humans = state.players.filter((p) => !p.isBot).length;

  const copy = () => {
    navigator.clipboard?.writeText(state.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="lobby">
      <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={onExit}>← Leave lobby</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h2>Lobby</h2>
        <button className="code-chip" onClick={copy} title="Click to copy">
          {state.code}
        </button>
        <span style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>
          {copied ? 'Copied!' : 'Share this code with your friends'}
        </span>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Players ({state.players.length}/{state.settings.seats})</h3>
        {state.players.map((p, i) => (
          <div className="seat" key={p.id}>
            <span className="dot" style={{ background: ['#e05252', '#4a7fd4', '#e8a33d', '#5aa860', '#9a6bd0', '#4fb8c9'][i] }} />
            <span className="name">
              {p.name}
              {' '}
              <span className="sub">
                {p.id === state.hostId ? '· host' : ''}
                {p.id === session.playerId ? ' · you' : ''}
                {p.isBot ? ` · ${p.botLevel} bot` : ''}
                {!p.isBot && session.presence && !session.presence[p.id] && p.id !== session.playerId ? ' · offline' : ''}
              </span>
            </span>
            {isHost && p.id !== state.hostId && (
              <button
                className="btn small danger"
                onClick={() => session.lobbyDispatch({ type: 'remove_player', playerId: p.id })}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {isHost && state.players.length < state.settings.seats && (
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.7rem', flexWrap: 'wrap' }}>
            {['easy', 'medium', 'hard'].map((level) => (
              <button key={level} className="btn small" onClick={() => session.lobbyDispatch({ type: 'add_bot', level })}>
                + {level} bot
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Settings {isHost ? '' : '(host decides)'}</h3>
        <SettingsForm
          settings={state.settings}
          disabled={!isHost}
          onChange={(patch) => session.lobbyDispatch({ type: 'set_settings', settings: patch })}
        />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <ChatPanel
          state={state}
          myName={me?.name}
          onSend={(text) => session.lobbyDispatch({ type: 'chat', text, name: me?.name || 'Player' })}
        />
      </div>

      {isHost ? (
        <button
          className="btn primary"
          style={{ padding: '0.8rem', fontSize: '1.05rem' }}
          disabled={state.players.length < 2}
          onClick={() => session.startGame()}
        >
          Start game ({state.players.length} players{state.players.length >= 5 ? ', large board' : ''})
        </button>
      ) : (
        <p style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>
          Waiting for the host to start the game… {humans} human{humans === 1 ? '' : 's'} connected.
        </p>
      )}
    </div>
  );
}
