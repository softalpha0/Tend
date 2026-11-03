import { SessionMode, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { HandGestureSystem } from './hands.js';
import { unlockAudio } from './sound.js';
import { addFriend, shareLink, takeFriendCode, takeSharedGarden } from './share.js';
import { currentStreak, formatMinutes, loadState, saveState, weekSummary } from './state.js';
import { ensureIdentity, MAX_LIVE_FRIENDS, normalizeCode, syncConfig } from './sync.js';
import { voiceSupported } from './voice.js';
import { TendSystem } from './tend-system.js';

// Before the world loads the saved state: give this device a friend code when
// live sync is set up, and add a friend's garden from a share link.
const live = syncConfig() !== null;
const sharedCode = takeFriendCode();
const visiting = takeSharedGarden();
{
  const state = loadState();
  let changed = live && ensureIdentity(state);
  const code = sharedCode ? normalizeCode(sharedCode) : null;
  if (visiting) {
    if (live && code) visiting.code = code;
    state.friends = addFriend(state.friends, visiting);
    changed = true;
  }
  if (live && code && code !== state.syncCode && !state.friendCodes.includes(code)) {
    state.friendCodes = [code, ...state.friendCodes].slice(0, MAX_LIVE_FRIENDS);
    changed = true;
  }
  if (changed) saveState(state);
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(HandGestureSystem, { priority: -1 });
  world.registerSystem(TendSystem);
  setUpLanding(world);

  // Installed as an app (Meta Quest PWA): there is no page to click, so the
  // launch itself enters mixed reality. Browser tabs keep the Enter button.
  if ('getDigitalGoodsService' in window && navigator.xr) {
    void navigator.xr
      .isSessionSupported(SessionMode.ImmersiveAR)
      .then((supported) => {
        if (supported) world.launchXR();
      })
      .catch(() => undefined);
  }
});

// Offline support for the installed app (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

/** The HTML landing card: explains Tend and offers the way into mixed reality. */
function setUpLanding(world: World): void {
  const landing = document.getElementById('landing')!;
  const enter = document.getElementById('enter-xr') as HTMLButtonElement;
  const note = document.getElementById('xr-note')!;
  const hide = document.getElementById('hide-landing') as HTMLButtonElement;

  void navigator.xr
    ?.isSessionSupported(SessionMode.ImmersiveAR)
    .then((supported) => {
      enter.disabled = !supported;
      note.textContent = supported
        ? 'Put your controllers down. Tend works with your hands.'
        : 'Open this page in the Meta Quest browser to place Tend on your real desk. You can also try it here with your mouse.';
    })
    .catch(() => undefined);
  if (!navigator.xr) {
    enter.disabled = true;
    note.textContent =
      'Open this page in the Meta Quest browser to place Tend on your real desk. You can also try it here with your mouse.';
  }

  // Sound settings live in saved state; TendSystem listens for changes.
  const saved = loadState();
  for (const key of ['ambient', 'spoken', 'highContrast', 'voice'] as const) {
    const box = document.getElementById(key) as HTMLInputElement;
    box.checked = saved[key];
    if (key === 'voice' && !voiceSupported()) {
      box.checked = false;
      box.disabled = true;
      box.parentElement!.title = 'Voice commands are not supported in this browser';
      box.parentElement!.style.opacity = '0.55';
    }
    box.addEventListener('change', () => {
      window.dispatchEvent(new CustomEvent('tend-settings', { detail: { [key]: box.checked } }));
    });
  }

  setUpSharing();

  enter.addEventListener('click', () => {
    unlockAudio();
    world.launchXR();
  });
  hide.addEventListener('click', () => {
    unlockAudio();
    landing.classList.add('hidden');
  });
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  world.visibilityState.subscribe((visibility) => {
    landing.classList.toggle('in-xr', visibility !== VisibilityState.NonImmersive);
  });
}

function setUpSharing(): void {
  const nameInput = document.getElementById('garden-name') as HTMLInputElement;
  const shareButton = document.getElementById('share-garden') as HTMLButtonElement;
  const status = document.getElementById('share-status')!;
  const friendsNote = document.getElementById('friends-note')!;
  const send = (detail: Record<string, unknown>) =>
    window.dispatchEvent(new CustomEvent('tend-settings', { detail }));

  const showFriends = () => {
    const friends = loadState().friends;
    friendsNote.hidden = friends.length === 0;
    if (friends.length === 0) return;
    const names = friends.map((f) => f.name).join(', ');
    friendsNote.innerHTML = '';
    friendsNote.append(`On your desk: ${names}'s garden${friends.length > 1 ? 's' : ''}. `);
    const clear = document.createElement('button');
    clear.id = 'clear-friends';
    clear.textContent = 'Remove';
    clear.addEventListener('click', () => {
      send({ clearFriends: true });
      friendsNote.hidden = true;
    });
    friendsNote.append(clear);
  };

  nameInput.value = loadState().name;
  nameInput.addEventListener('change', () => send({ name: nameInput.value.trim() }));

  if (visiting) {
    status.textContent = live
      ? `${visiting.name}'s garden is now on your desk, and it stays up to date.`
      : `${visiting.name}'s garden is now on your desk, next to yours.`;
  }
  showFriends();
  setUpLiveSync(send, status, showFriends);
  showWeek();

  shareButton.addEventListener('click', async () => {
    send({ name: nameInput.value.trim() });
    const state = loadState();
    state.name = nameInput.value.trim();
    if (state.garden.length === 0) {
      status.textContent = 'Finish a session first, so there is a plant to share.';
      return;
    }
    const link = shareLink(state, currentStreak(state), live ? state.syncCode : undefined);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'My Tend garden', text: 'Here is my focus garden on Tend.', url: link });
        status.textContent = 'Shared.';
        return;
      }
    } catch {
      // Share sheet closed or unavailable: fall back to copying.
    }
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = 'Link copied. Send it to a friend: ' + link;
    } catch {
      status.textContent = 'Copy this link and send it to a friend: ' + link;
    }
  });
}

/** Friend codes for live shared gardens (only when Supabase is set up). */
function setUpLiveSync(
  send: (detail: Record<string, unknown>) => void,
  status: HTMLElement,
  refreshNote: () => void,
): void {
  const box = document.getElementById('live-sync')!;
  if (!live) return;
  box.hidden = false;
  (document.getElementById('my-code') as HTMLElement).textContent = loadState().syncCode;
  const input = document.getElementById('friend-code') as HTMLInputElement;
  const add = () => {
    const code = normalizeCode(input.value);
    if (!code) {
      status.textContent = 'Friend codes are 8 letters and numbers, like K7M2QX9A.';
      return;
    }
    if (code === loadState().syncCode) {
      status.textContent = 'That is your own code. Send it to a friend instead.';
      return;
    }
    send({ addFriendCode: code });
    input.value = '';
    status.textContent = 'Added. Their garden appears on your desk once it loads.';
    window.setTimeout(refreshNote, 3000);
  };
  document.getElementById('add-friend')!.addEventListener('click', add);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') add();
  });
}

/** The last seven days, shown on the start card. */
function showWeek(): void {
  const state = loadState();
  const week = weekSummary(state);
  const box = document.getElementById('week')!;
  if (week.sessions === 0) return;
  const streak = week.streak > 1 ? ` · ${week.streak}-day streak` : '';
  box.textContent = `This week: ${week.sessions} session${week.sessions === 1 ? '' : 's'} · ${formatMinutes(week.minutes)} focused${streak}`;
  box.hidden = false;
}
