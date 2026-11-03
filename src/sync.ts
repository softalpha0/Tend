/**
 * Live shared gardens through Supabase. Each device has a public friend code
 * and a private secret; it publishes its own garden and polls friends' gardens
 * by code. Everything degrades to link-only sharing when sync isn't set up.
 */
import { SPECIES, SpeciesId } from './species.js';
import type { FriendGarden, TendState } from './state.js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './sync-config.js';

export interface SyncConfig {
  url: string;
  key: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L
export const MAX_LIVE_FRIENDS = 5;
const MAX_PLANTS = 8;

export function syncConfig(): SyncConfig | null {
  let url = SUPABASE_URL;
  let key = SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Local override, used for testing against another project.
    try {
      const saved = JSON.parse(localStorage.getItem('tend.syncConfig') ?? 'null') as Partial<SyncConfig> | null;
      if (saved?.url && saved?.key) {
        url = saved.url;
        key = saved.key;
      }
    } catch {
      // Ignore a broken override.
    }
  }
  return url && key ? { url: url.replace(/\/+$/, ''), key } : null;
}

/** Gives this device a friend code and a secret, once. Returns true if it changed the state. */
export function ensureIdentity(state: TendState): boolean {
  let changed = false;
  if (!state.syncCode) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    state.syncCode = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    changed = true;
  }
  if (!state.syncSecret) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    state.syncSecret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    changed = true;
  }
  return changed;
}

export function normalizeCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{6,10}$/.test(code) ? code : null;
}

function headers(config: SyncConfig): HeadersInit {
  const result: Record<string, string> = { apikey: config.key, 'Content-Type': 'application/json' };
  // Legacy anon keys are JWTs and also go in Authorization; new publishable keys (sb_publishable_…) don't.
  if (config.key.split('.').length === 3) result.Authorization = `Bearer ${config.key}`;
  return result;
}

export async function publishGarden(config: SyncConfig, state: TendState, streak: number): Promise<boolean> {
  if (!state.syncCode || !state.syncSecret) return false;
  const response = await fetch(`${config.url}/rest/v1/rpc/upsert_garden`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({
      p_code: state.syncCode,
      p_secret: state.syncSecret,
      p_name: state.name.slice(0, 20),
      p_streak: streak,
      p_plants: state.garden.slice(-MAX_PLANTS).map((p) => ({ species: p.species ?? 'daisy', hue: p.hue % 6 })),
    }),
  });
  return response.ok;
}

export async function fetchGardens(config: SyncConfig, codes: string[]): Promise<FriendGarden[]> {
  if (codes.length === 0) return [];
  const list = codes.map(encodeURIComponent).join(',');
  const response = await fetch(
    `${config.url}/rest/v1/public_gardens?select=code,name,streak,plants,updated_at&code=in.(${list})`,
    { headers: headers(config) },
  );
  if (!response.ok) throw new Error(`sync ${response.status}`);
  const rows = (await response.json()) as unknown[];
  return rows.flatMap((row) => {
    const r = row as Record<string, unknown>;
    const code = typeof r.code === 'string' ? normalizeCode(r.code) : null;
    if (!code || !Array.isArray(r.plants)) return [];
    const ids = SPECIES.map((s) => s.id);
    const plants = r.plants.slice(0, MAX_PLANTS).flatMap((p) => {
      const plant = p as Record<string, unknown>;
      const species = ids.includes(plant.species as SpeciesId) ? (plant.species as SpeciesId) : 'daisy';
      const hue = Math.max(0, Math.min(5, Math.round(Number(plant.hue)) || 0));
      return [{ species, hue }];
    });
    const name = String(r.name ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 20);
    return [
      {
        name: name || 'A friend',
        streak: Math.max(0, Math.min(9999, Math.round(Number(r.streak)) || 0)),
        plants,
        sharedAt: Date.parse(String(r.updated_at)) || Date.now(),
        code,
      },
    ];
  });
}
