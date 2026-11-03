/**
 * Saved state for Tend. Everything lives in localStorage so the garden and an
 * in-progress session survive closing the browser.
 */

import type { SpeciesId } from './species.js';

export type Phase = 'empty' | 'planted' | 'growing' | 'bloomed' | 'wilted';

export interface GardenPlant {
  hue: number; // index into BLOOM_COLORS
  finishedAt: number;
  minutes: number;
  species?: SpeciesId;
}

/** A friend's garden, as of the share link they sent. */
export interface FriendGarden {
  name: string;
  streak: number;
  plants: { species: SpeciesId; hue: number }[];
  sharedAt: number;
}

export interface TendState {
  phase: Phase;
  /** Session length the user picked, in minutes. */
  durationMin: number;
  /** When the current session started (ms since epoch). */
  startedAt: number;
  /** Length of the current session in ms. */
  durationMs: number;
  /** Last time the user was present in the app during a session. */
  lastSeen: number;
  /** When the current bloomed or wilted phase began. */
  phaseAt: number;
  /** Pot position on the desk, in the desk plane's local x/z. */
  deskOffset: [number, number] | null;
  garden: GardenPlant[];
  completed: number;
  wilted: number;
  streakDays: number;
  lastCompleteDay: string;
  /** Soft background sound during a session. */
  ambient: boolean;
  /** Read cues aloud (start, halfway, two minutes left, time left on palm-up). */
  spoken: boolean;
  /** Larger, higher-contrast labels. */
  highContrast: boolean;
  /** Voice commands as an alternative to gestures. */
  voice: boolean;
  /** Highest daily streak ever reached; unlocks never go away. */
  bestStreak: number;
  /** Species of the next seed. */
  species: SpeciesId;
  /** Species planted in the pot right now. */
  plantedSpecies: SpeciesId;
  /** Name shown on a shared garden. */
  name: string;
  friends: FriendGarden[];
  /** The first session is a short starter so new users see a bloom quickly. */
  starter: boolean;
  /** Which gestures the user has done at least once; the ghost hand stops showing them. */
  learned: { plant: boolean; water: boolean; time: boolean };
}

export const DURATION_CHOICES = [5, 10, 25, 50];
/** Length of the very first session, so a new user sees a bloom in a couple of minutes. */
export const STARTER_MINUTES = 2;

const STORAGE_KEY = 'tend.state.v1';

function defaults(): TendState {
  return {
    phase: 'empty',
    durationMin: 10,
    startedAt: 0,
    durationMs: 0,
    lastSeen: 0,
    phaseAt: 0,
    deskOffset: null,
    garden: [],
    completed: 0,
    wilted: 0,
    streakDays: 0,
    lastCompleteDay: '',
    ambient: true,
    spoken: false,
    highContrast: false,
    voice: false,
    starter: true,
    bestStreak: 0,
    species: 'daisy',
    plantedSpecies: 'daisy',
    name: '',
    friends: [],
    learned: { plant: false, water: false, time: false },
  };
}

export function loadState(): TendState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<TendState>;
      const base = defaults();
      return {
        ...base,
        ...saved,
        // Saves from before the starter session existed: only new users get it.
        starter: saved.starter ?? !(saved.completed && saved.completed > 0),
        bestStreak: Math.max(saved.bestStreak ?? 0, saved.streakDays ?? 0),
        learned: { ...base.learned, ...saved.learned },
      };
    }
  } catch {
    // Storage blocked or corrupt: start fresh.
  }
  return defaults();
}

export function saveState(state: TendState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the session still works, it just won't persist.
  }
}

/** `?minutes=1` overrides the session length, for testing. */
export function testMinutesOverride(): number | null {
  const value = new URLSearchParams(location.search).get('minutes');
  const minutes = value == null ? NaN : Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export function localDay(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** The streak as it stands today: it lapses if yesterday was missed. */
export function currentStreak(state: TendState, now = Date.now()): number {
  const today = localDay(now);
  const yesterday = localDay(now - 86_400_000);
  return state.lastCompleteDay === today || state.lastCompleteDay === yesterday ? state.streakDays : 0;
}
