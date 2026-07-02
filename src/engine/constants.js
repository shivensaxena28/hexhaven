// Game constants: resources, costs, piece limits, deck compositions.

export const RESOURCES = ['brick', 'wood', 'sheep', 'wheat', 'ore'];

export const COSTS = {
  road: { brick: 1, wood: 1 },
  settlement: { brick: 1, wood: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
};

// Per-player piece supply (same for the 5-6 player game; the expansion adds
// players, not pieces per player).
export const PIECE_LIMITS = { road: 15, settlement: 5, city: 4 };

export const DEV_CARDS = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'vp'];

// Deck composition by board size.
export const DEV_DECK_BASE = { knight: 14, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2, vp: 5 };
export const DEV_DECK_LARGE = { knight: 20, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3, vp: 5 };

export const BANK_PER_RESOURCE_BASE = 19;
export const BANK_PER_RESOURCE_LARGE = 24;

// 19-tile board: terrain and number tokens.
export const TERRAIN_BASE = [
  'wood', 'wood', 'wood', 'wood',
  'wheat', 'wheat', 'wheat', 'wheat',
  'sheep', 'sheep', 'sheep', 'sheep',
  'brick', 'brick', 'brick',
  'ore', 'ore', 'ore',
  'desert',
];
export const TOKENS_BASE = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

// 30-tile board (5-6 players): terrain and number tokens.
export const TERRAIN_LARGE = [
  'wood', 'wood', 'wood', 'wood', 'wood', 'wood',
  'wheat', 'wheat', 'wheat', 'wheat', 'wheat', 'wheat',
  'sheep', 'sheep', 'sheep', 'sheep', 'sheep', 'sheep',
  'brick', 'brick', 'brick', 'brick', 'brick',
  'ore', 'ore', 'ore', 'ore', 'ore',
  'desert', 'desert',
];
export const TOKENS_LARGE = [
  2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6,
  8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
];

// Ports: '3:1' is a generic port, otherwise 2:1 for the named resource.
export const PORTS_BASE = ['3:1', '3:1', '3:1', '3:1', 'brick', 'wood', 'sheep', 'wheat', 'ore'];
export const PORTS_LARGE = [
  '3:1', '3:1', '3:1', '3:1', '3:1',
  'brick', 'wood', 'sheep', 'sheep', 'wheat', 'ore',
];

export const PLAYER_COLORS = ['#e05252', '#4a7fd4', '#e8a33d', '#5aa860', '#9a6bd0', '#4fb8c9'];

export const DEFAULT_SETTINGS = {
  targetVP: 10,
  friendlyRobber: false,
  discardOn7: true,
  no7FirstTwoRounds: false,
  playerTrading: true,
  longestRoadEnabled: true,
  largestArmyEnabled: true,
  devCardDelay: true,
  robberMustMove: true,
  turnTimerSeconds: 0, // 0 = off
};
