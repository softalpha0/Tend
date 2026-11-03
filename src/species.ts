/**
 * Plant species. Daisy is available from the start; the rest unlock with a
 * daily streak, and stay unlocked once earned (based on the best streak).
 */

export type SpeciesId = 'daisy' | 'tulip' | 'sunflower' | 'lavender' | 'cactus';

export interface Species {
  id: SpeciesId;
  name: string;
  /** Best daily streak needed to unlock. */
  unlockStreak: number;
  /** Colour of the seed, so the chosen species is visible before planting. */
  seedColor: string;
}

export const SPECIES: Species[] = [
  { id: 'daisy', name: 'Daisy', unlockStreak: 0, seedColor: '#d9a35f' },
  { id: 'tulip', name: 'Tulip', unlockStreak: 2, seedColor: '#8a5a3b' },
  { id: 'sunflower', name: 'Sunflower', unlockStreak: 3, seedColor: '#5b5b5b' },
  { id: 'lavender', name: 'Lavender', unlockStreak: 5, seedColor: '#8f7bb8' },
  { id: 'cactus', name: 'Cactus flower', unlockStreak: 7, seedColor: '#6f9b5a' },
];

export function speciesById(id: string | undefined): Species {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[0];
}

export function unlockedSpecies(bestStreak: number): Species[] {
  return SPECIES.filter((s) => bestStreak >= s.unlockStreak);
}

/** The next species to unlock, or null when all are unlocked. */
export function nextUnlock(bestStreak: number): Species | null {
  return SPECIES.find((s) => bestStreak < s.unlockStreak) ?? null;
}
