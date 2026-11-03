/**
 * Optional voice commands, an alternative to hand gestures for people who
 * can't easily pinch or turn a palm. Uses the Web Speech API where the browser
 * provides it; elsewhere the setting is disabled.
 */

export type VoiceCommand = 'plant' | 'water' | 'time' | 'end' | 'help' | 'week';

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

const PHRASES: [VoiceCommand, RegExp][] = [
  ['end', /\b(end|stop|quit) (the )?session\b/],
  ['week', /\b(this week|my week|summary)\b/],
  ['plant', /\b(plant|seed)\b/],
  ['water', /\b(water|start|begin)\b/],
  ['time', /\b(time|how long|left|remaining)\b/],
  ['help', /\b(help|what now|what do i do)\b/],
];

export function voiceSupported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return typeof (w.SpeechRecognition ?? w.webkitSpeechRecognition) === 'function';
}

export class VoiceCommands {
  private recognition: Recognition | null = null;
  private wanted = false;

  constructor(private onCommand: (command: VoiceCommand) => void) {}

  setEnabled(on: boolean): void {
    this.wanted = on;
    if (on) this.start();
    else this.recognition?.stop();
  }

  private start(): void {
    if (!voiceSupported()) return;
    if (!this.recognition) {
      const w = window as unknown as Record<string, new () => Recognition>;
      const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0].transcript.toLowerCase();
          const match = PHRASES.find(([, pattern]) => pattern.test(text));
          if (match) this.onCommand(match[0]);
        }
      };
      // Recognition stops after silence; keep listening while enabled.
      recognition.onend = () => {
        if (this.wanted) {
          try {
            recognition.start();
          } catch {
            // Already running.
          }
        }
      };
      recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') this.wanted = false;
      };
      this.recognition = recognition;
    }
    try {
      this.recognition.start();
    } catch {
      // Already running.
    }
  }
}
