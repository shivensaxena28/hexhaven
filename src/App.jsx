// Top-level screen router. Owns the session object; everything below renders
// from the session's synced state.

import { useState, useSyncExternalStore, useCallback } from 'react';
import Home from './ui/Home.jsx';
import Lobby from './ui/Lobby.jsx';
import Game from './ui/Game.jsx';
import { OnlineSession, LocalSession, makeLobbyCode, getPlayerId } from './net/session.js';

export default function App() {
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const subscribe = useCallback((cb) => (session ? session.subscribe(cb) : () => {}), [session]);
  const getSnapshot = useCallback(() => (session ? session.getSnapshot() : null), [session]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const leave = () => {
    session?.leave();
    setSession(null);
    setError(null);
    if (location.hash) history.replaceState(null, '', location.pathname);
  };

  const createOnline = async (name) => {
    setBusy(true);
    setError(null);
    try {
      const s = new OnlineSession({ code: makeLobbyCode(), playerId: getPlayerId(), name });
      await s.create();
      location.hash = s.code;
      setSession(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const joinOnline = async (code, name) => {
    setBusy(true);
    setError(null);
    try {
      const s = new OnlineSession({ code, playerId: getPlayerId(), name });
      await s.join();
      location.hash = code;
      setSession(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startLocal = (players, settings) => {
    const s = new LocalSession();
    s.startLocalGame(players, settings);
    setSession(s);
  };

  const resumeLocal = () => {
    const s = LocalSession.resumeFromStorage();
    if (s) setSession(s);
  };

  if (!session || !state) {
    return (
      <Home
        onCreate={createOnline}
        onJoin={joinOnline}
        onLocal={startLocal}
        onResumeLocal={resumeLocal}
        hasLocalSave={LocalSession.hasResumableSave()}
        initialCode={location.hash.replace('#', '').toUpperCase() || ''}
        busy={busy}
        error={error}
      />
    );
  }

  if (state.phase === 'lobby') {
    return <Lobby session={session} state={state} onExit={leave} />;
  }

  return <Game session={session} state={state} onExit={leave} />;
}
