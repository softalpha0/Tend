import { SessionMode, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { HandGestureSystem } from './hands.js';
import { unlockAudio } from './sound.js';
import { addFriend, shareLink, takeSharedGarden } from './share.js';
import { currentStreak, loadState, saveState } from './state.js';
import { voiceSupported } from './voice.js';
import { TendSystem } from './tend-system.js';

// A friend's share link: add their garden before the world loads the saved state.
const visiting = takeSharedGarden();
if (visiting) {
  const state = loadState();
  state.friends = addFriend(state.friends, visiting);
  saveState(state);
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(HandGestureSystem, { priority: -1 });
  world.registerSystem(TendSystem);
  setUpLanding(world);
});

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
    status.textContent = `${visiting.name}'s garden is now on your desk, next to yours.`;
  }
  showFriends();

  shareButton.addEventListener('click', async () => {
    send({ name: nameInput.value.trim() });
    const state = loadState();
    state.name = nameInput.value.trim();
    if (state.garden.length === 0) {
      status.textContent = 'Finish a session first, so there is a plant to share.';
      return;
    }
    const link = shareLink(state, currentStreak(state));
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
