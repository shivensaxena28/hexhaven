// The landing screen: create an online lobby, join with a code, or set up a
// local hot-seat game (also the way to watch bots play).

import { useState } from 'react';
import { onlineAvailable } from '../net/supabaseClient.js';
import { DEFAULT_SETTINGS } from '../engine/constants.js';
import SettingsForm from './SettingsForm.jsx';

export default function Home({ onCreate, onJoin, onLocal, onResumeLocal, hasLocalSave, initialCode, busy, error }) {
  const [name, setName] = useState(localStorage.getItem('hexhaven:name') || '');
  const [code, setCode] = useState(initialCode || '');
  const [localOpen, setLocalOpen] = useState(false);

  const saveName = (n) => {
    setName(n);
    localStorage.setItem('hexhaven:name', n);
  };
  const named = name.trim().length > 0;
  const online = onlineAvailable();

  return (
    <div className="home">
      <h1>⬡ HexHaven</h1>
      <p className="tagline">
        Settle the island: gather resources, build roads and towns,<br />
        outwit the robber, and race to victory. 2–6 players.
      </p>

      <div className="card">
        <div className="field">
          <label>Your display name</label>
          <input
            value={name}
            maxLength={20}
            placeholder="e.g. Astrid"
            onChange={(e) => saveName(e.target.value)}
          />
        </div>

        <button
          className="btn primary"
          disabled={!named || !online || busy}
          onClick={() => onCreate(name.trim())}
        >
          {busy ? 'Working…' : 'Create online game'}
        </button>

        <div className="divider">or join with a code</div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 10, padding: '0.55rem 0.75rem', textTransform: 'uppercase', fontFamily: 'ui-monospace, monospace', letterSpacing: '0.2em' }}
            value={code}
            maxLength={6}
            placeholder="ABC123"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <button
            className="btn"
            disabled={!named || code.length !== 6 || !online || busy}
            onClick={() => onJoin(code, name.trim())}
          >
            Join
          </button>
        </div>

        <div className="divider">or play on this device</div>
        <button className="btn" onClick={() => setLocalOpen(true)}>
          Local hot-seat / vs bots
        </button>
        {hasLocalSave && (
          <button className="btn" onClick={onResumeLocal}>Resume saved local game</button>
        )}

        {!online && (
          <p className="offline-note">
            Online play is not configured — set VITE_SUPABASE_URL and
            VITE_SUPABASE_ANON_KEY to enable it (see the README). Local play works regardless.
          </p>
        )}
        {error && <p className="offline-note" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>

      {localOpen && (
        <LocalSetup
          defaultName={name.trim() || 'Player 1'}
          onStart={(players, settings) => { setLocalOpen(false); onLocal(players, settings); }}
          onClose={() => setLocalOpen(false)}
        />
      )}
    </div>
  );
}

function LocalSetup({ defaultName, onStart, onClose }) {
  const [seats, setSeats] = useState([
    { name: defaultName, isBot: false, botLevel: null },
    { name: 'Bot 1 (medium)', isBot: true, botLevel: 'medium' },
    { name: 'Bot 2 (medium)', isBot: true, botLevel: 'medium' },
    { name: 'Bot 3 (medium)', isBot: true, botLevel: 'medium' },
  ]);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });

  const setSeat = (i, patch) => setSeats(seats.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(96vw, 36rem)' }}>
        <h3>Local game</h3>
        {seats.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' }}>
            <input
              style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 8, padding: '0.4rem 0.6rem' }}
              value={s.name}
              maxLength={20}
              onChange={(e) => setSeat(i, { name: e.target.value })}
            />
            <select
              value={s.isBot ? s.botLevel : 'human'}
              onChange={(e) => {
                const v = e.target.value;
                setSeat(i, v === 'human'
                  ? { isBot: false, botLevel: null }
                  : { isBot: true, botLevel: v, name: `Bot ${i} (${v})` });
              }}
            >
              <option value="human">Human</option>
              <option value="easy">Easy bot</option>
              <option value="medium">Medium bot</option>
              <option value="hard">Hard bot</option>
            </select>
            <button className="btn small danger" disabled={seats.length <= 2} onClick={() => setSeats(seats.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button
          className="btn small"
          disabled={seats.length >= 6}
          onClick={() => setSeats([...seats, { name: `Bot ${seats.length} (medium)`, isBot: true, botLevel: 'medium' }])}
          style={{ marginBottom: '0.9rem' }}
        >
          + Add seat
        </button>
        <SettingsForm settings={settings} showSeats={false} onChange={(patch) => setSettings({ ...settings, ...patch })} />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={seats.some((s) => !s.name.trim())}
            onClick={() => onStart(
              seats.map((s, i) => ({ id: `seat-${i}`, name: s.name.trim(), isBot: s.isBot, botLevel: s.botLevel })),
              settings,
            )}
          >
            Start ({seats.length} players{seats.length >= 5 ? ', large board' : ''})
          </button>
        </div>
      </div>
    </div>
  );
}
