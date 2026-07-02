# ⬡ Hexhaven

A real-time multiplayer settlement-building strategy game for 2–6 players,
playable in any modern browser. Gather resources, build roads and towns,
dodge the robber, and race to the victory-point target.

No accounts, no logins: one player creates a lobby and shares a 6-character
code; everyone else enters the code and a display name.

> Hexhaven is an original-themed implementation of the classic hex-tile
> resource-trading game genre. All names, art, and code are original.

## Features

- **Full base ruleset** — snake-draft setup, dice production, robber +
  discard-on-7, all five development cards, player and bank/port trading
  (4:1 / 3:1 / 2:1), Longest Road, Largest Army, configurable victory target.
- **2–6 players** — 19-tile board for 2–4, the larger 30-tile board with the
  Special Building Phase for 5–6.
- **House rules** — friendly robber, no 7s in the first two rounds, discard
  on 7, player trading on/off, and more (all toggleable in the lobby).
- **AI bots** — fill empty seats with easy / medium / hard bots; they run in
  the host's browser and their moves are validated by the same rules engine.
- **Host-authoritative realtime sync** — the lobby creator's browser is the
  referee. Other clients send action intents over Supabase Realtime; the host
  validates them, persists the canonical state, and broadcasts it. Refresh to
  reconnect and resume; if the host drops, another player takes over.
- **Extras** — in-game chat, a scrollable dice/event log, an optional
  per-turn timer, and synthesized sound effects with a mute toggle.
- **Local hot-seat mode** — play on one device (or watch bots) with no
  Supabase project at all.

## Tech

- [React](https://react.dev) + [Vite](https://vite.dev) frontend
- [Supabase](https://supabase.com) (Postgres + Realtime) for lobbies,
  persistence, and sync
- [Vitest](https://vitest.dev) for the rules-engine test suite
- The game engine (`src/engine/`) is pure JavaScript with no dependencies —
  deterministic, seedable, and fully unit-tested.

All dependencies are MIT/Apache-2.0 licensed.

## Getting started

### 1. Prerequisites

- [Node.js](https://nodejs.org) 20+ (24 LTS recommended) — includes npm
- A free [Supabase](https://supabase.com) project (only for online play;
  skip for local hot-seat)

### 2. Install and run locally

```bash
git clone https://github.com/shivensaxena28/hexhaven.git
cd hexhaven
npm install
npm run dev
```

Open the printed URL. **Local hot-seat mode works immediately** — online
play needs the two steps below.

### 3. Create the Supabase backend

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Open **SQL Editor → New query**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates the
   `games` table with Row Level Security enabled.
3. In **Project Settings → API**, copy the **Project URL** and the
   **anon (public) key**.

### 4. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:

```
VITE_SUPABASE_URL=<SUPABASE_URL>
VITE_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>
```

`.env.local` is gitignored — never commit keys or hardcode them in source.
The anon key is safe to ship to browsers *only because* RLS is enabled; the
`service_role` key must never appear in frontend code. Note that Hexhaven is
accountless by design: the RLS policies allow anonymous clients to read and
write game rows, with the lobby code as the only shared secret. Don't reuse
this Supabase project for data that needs stricter access control.

Restart `npm run dev` after changing env vars.

### 5. Run the tests

```bash
npm test
```

The suite covers board generation, every build/trade/robber rule, dev cards,
Longest Road edge cases, the 5–6 player Special Building Phase, and plays
complete bot-vs-bot games at each difficulty.

## Deploying (free static hosting)

`npm run build` produces a static site in `dist/`. Any static host works:

- **Vercel / Netlify** — import the GitHub repo, framework preset "Vite",
  build command `npm run build`, output directory `dist`. Add
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables
  in the project settings.
- **Cloudflare Pages** — same settings as above.
- **GitHub Pages** — build in an Action (inject the two env vars from
  [GitHub Actions secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions))
  and publish `dist/`. If the site is served from a subpath
  (`username.github.io/hexhaven`), set `base: '/hexhaven/'` in
  `vite.config.js`.

## How the sync works

```
players' browsers                    host's browser (lobby creator)
┌────────────────┐   action intent   ┌─────────────────────────────┐
│ render state ──┼──────────────────▶│ validate with rules engine   │
│ from host      │                   │ apply → new canonical state  │
│                │◀──────────────────┼─ broadcast + persist to      │
└────────────────┘   state (v N+1)   │  `games` row in Supabase     │
                                     └─────────────────────────────┘
```

- Each lobby is one Supabase Realtime channel (`game:CODE`), used for action
  intents, state broadcasts, and presence.
- The canonical state (JSON) is persisted to the `games` row on every change,
  so any player — including the host — can refresh and resume.
- Clients never trust their own mutations; they render only host-confirmed
  state. Bot turns run in the host's browser through the same validation.
- If presence shows the host has gone, the game pauses; after a grace period
  the connected human in the lowest seat claims host authority with an
  optimistic-concurrency update, and play resumes.

## Project layout

```
src/
  engine/       pure rules engine (no UI, no network) + tests
    board.js      board generation, hex/vertex/edge graph
    game.js       createGame + reduce(state, action) — all rules
    longestRoad.js, bots.js, constants.js, rng.js
  net/          Supabase client + Local/Online sessions (host authority)
  ui/           React components: home, lobby, board (SVG), panels, dialogs
supabase/
  schema.sql    table + RLS policies
```

## License

MIT — see [LICENSE](LICENSE).
