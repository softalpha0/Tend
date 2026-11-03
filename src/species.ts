/**
 * Plant species. Daisy is available from the start; streak plants unlock with
 * a daily streak and stay unlocked once earned (based on the best streak).
 * Seasonal plants can be grown by anyone while their season lasts.
 */

export type SpeciesId =
  | 'daisy'
  | 'tulip'
  | 'sunflower'
  | 'lavender'
  | 'cactus'
  | 'hellebore'
  | 'cherry'
  | 'hibiscus'
  | 'chrysanthemum';

export interface Species {
  id: SpeciesId;
  name: string;
  /** Best daily streak needed to unlock. */
  unlockStreak: number;
  /** Colour of the seed, so the chosen species is visible before planting. */
  seedColor: string;
  /** Months (0 = January) when a seasonal plant can be grown. */
  months?: number[];
  season?: string;
}

export const SPECIES: Species[] = [
  { id: 'daisy', name: 'Daisy', unlockStreak: 0, seedColor: '#d9a35f' },
  { id: 'tulip', name: 'Tulip', unlockStreak: 2, seedColor: '#8a5a3b' },
  { id: 'sunflower', name: 'Sunflower', unlockStreak: 3, seedColor: '#5b5b5b' },
  { id: 'lavender', name: 'Lavender', unlockStreak: 5, seedColor: '#8f7bb8' },
  { id: 'cactus', name: 'Cactus flower', unlockStreak: 7, seedColor: '#6f9b5a' },
  // Seasonal plants. Keep new species at the end: share links store list positions.
  { id: 'hellebore', name: 'Winter rose', unlockStreak: Infinity, seedColor: '#e8e2d4', months: [11, 0, 1], season: 'winter' },
  { id: 'cherry', name: 'Cherry blossom', unlockStreak: Infinity, seedColor: '#e9a3bd', months: [2, 3, 4], season: 'spring' },
  { id: 'hibiscus', name: 'Hibiscus', unlockStreak: Infinity, seedColor: '#d9534f', months: [5, 6, 7], season: 'summer' },
  { id: 'chrysanthemum', name: 'Chrysanthemum', unlockStreak: Infinity, seedColor: '#d98a3a', months: [8, 9, 10], season: 'autumn' },
];

export function speciesById(id: string | undefined): Species {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[0];
}

export function inSeason(species: Species, now = new Date()): boolean {
  return species.months?.includes(now.getMonth()) ?? false;
}

/** Species the user can plant now: everything their best streak unlocked, plus this season's plant. */
export function unlockedSpecies(bestStreak: number, now = new Date()): Species[] {
  return SPECIES.filter((s) => bestStreak >= s.unlockStreak || inSeason(s, now));
}

/** The next streak plant to unlock, or null when all are unlocked. */
export function nextUnlock(bestStreak: number): Species | null {
  return SPECIES.find((s) => !s.months && bestStreak < s.unlockStreak) ?? null;
}

/** This season's plant. */
export function seasonalSpecies(now = new Date()): Species | null {
  return SPECIES.find((s) => inSeason(s, now)) ?? null;
}
