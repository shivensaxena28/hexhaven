// Game settings & house-rule toggles, shared by the online lobby and the
// local hot-seat setup screen.

export const TOGGLES = [
  ['discardOn7', 'Discard on 7 (8+ cards lose half)'],
  ['friendlyRobber', 'Friendly robber (spares players ≤ 2 VP)'],
  ['no7FirstTwoRounds', 'No 7s in the first two rounds'],
  ['playerTrading', 'Player-to-player trading'],
  ['longestRoadEnabled', 'Longest Road (2 VP)'],
  ['largestArmyEnabled', 'Largest Army (2 VP)'],
  ['devCardDelay', 'Dev cards wait a turn after purchase'],
  ['robberMustMove', 'Robber must move to a new tile'],
];

export default function SettingsForm({ settings, onChange, disabled, showSeats = true }) {
  const set = (key, value) => onChange({ [key]: value });
  return (
    <div className="settings-grid">
      {showSeats && (
        <div className="field">
          <label>Seats</label>
          <select
            disabled={disabled}
            value={settings.seats}
            onChange={(e) => set('seats', Number(e.target.value))}
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n} players{n >= 5 ? ' (large board)' : ''}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label>Victory points to win</label>
        <select
          disabled={disabled}
          value={settings.targetVP}
          onChange={(e) => set('targetVP', Number(e.target.value))}
        >
          {[5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((n) => (
            <option key={n} value={n}>{n}{n === 10 ? ' (standard)' : ''}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Turn timer</label>
        <select
          disabled={disabled}
          value={settings.turnTimerSeconds}
          onChange={(e) => set('turnTimerSeconds', Number(e.target.value))}
        >
          <option value={0}>Off</option>
          {[30, 45, 60, 90, 120, 180].map((n) => <option key={n} value={n}>{n} seconds</option>)}
        </select>
      </div>
      {TOGGLES.map(([key, label]) => (
        <label className="toggle" key={key}>
          <span>{label}</span>
          <input
            type="checkbox"
            disabled={disabled}
            checked={!!settings[key]}
            onChange={(e) => set(key, e.target.checked)}
          />
        </label>
      ))}
    </div>
  );
}
