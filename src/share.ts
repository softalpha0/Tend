/**
 * Shared gardens without a server: a garden travels as a link. Opening a
 * friend's link adds their garden to your desk, beside your own.
 */
import { SPECIES, SpeciesId } from './species.js';
import type { FriendGarden, TendState } from './state.js';

const PARAM = 'garden';
const FRIEND_PARAM = 'friend';
const MAX_FRIENDS = 3;
const MAX_SHARED_PLANTS = 8;

interface Payload {
  v: 1;
  n: string;
  s: number;
  p: [number, number][]; // [species index, hue]
}

/** A share link carries a snapshot of the garden, and the friend code when live sync is on. */
export function shareLink(state: TendState, streak: number, liveCode?: string): string {
  const payload: Payload = {
    v: 1,
    n: cleanName(state.name) || 'A friend',
    s: streak,
    p: state.garden.slice(-MAX_SHARED_PLANTS).map((plant) => [
      Math.max(0, SPECIES.findIndex((s) => s.id === (plant.species ?? 'daisy'))),
      plant.hue % 6,
    ]),
  };
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (liveCode) url.searchParams.set(FRIEND_PARAM, liveCode);
  url.searchParams.set(PARAM, encode(JSON.stringify(payload)));
  return url.toString();
}

/** Reads a shared friend code from the page URL, if there is one. */
export function takeFriendCode(): string | null {
  const url = new URL(location.href);
  const code = url.searchParams.get(FRIEND_PARAM);
  if (!code) return null;
  url.searchParams.delete(FRIEND_PARAM);
  history.replaceState(null, '', url.toString());
  return code;
}

/** Reads a garden from the page URL, if there is one, and removes it from the address bar. */
export function takeSharedGarden(): FriendGarden | null {
  const url = new URL(location.href);
  const raw = url.searchParams.get(PARAM);
  if (!raw) return null;
  url.searchParams.delete(PARAM);
  history.replaceState(null, '', url.toString());
  try {
    const data = JSON.parse(decode(raw)) as Partial<Payload>;
    if (data.v !== 1 || !Array.isArray(data.p)) return null;
    const plants = data.p
      .slice(0, MAX_SHARED_PLANTS)
      .filter((entry): entry is [number, number] => Array.isArray(entry) && entry.length === 2)
      .map(([speciesIndex, hue]) => ({
        species: (SPECIES[clampInt(speciesIndex, 0, SPECIES.length - 1)]?.id ?? 'daisy') as SpeciesId,
        hue: clampInt(hue, 0, 5),
      }));
    return {
      name: cleanName(String(data.n ?? '')) || 'A friend',
      streak: clampInt(Number(data.s), 0, 999),
      plants,
      sharedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/** Adds or refreshes a friend's garden, keeping the most recent few. */
export function addFriend(friends: FriendGarden[], friend: FriendGarden): FriendGarden[] {
  const others = friends.filter((f) => f.name !== friend.name);
  return [friend, ...others].slice(0, MAX_FRIENDS);
}

function cleanName(name: string): string {
  return name.replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 20);
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(text: string): string {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}
