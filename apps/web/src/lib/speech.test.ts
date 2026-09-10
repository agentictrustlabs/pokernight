/**
 * The coach's voice, and the one thing that silenced it.
 *
 * `u.voice = v` THROWS when the browser does not accept what `getVoices()` handed back, and that
 * assignment used to sit inside the same try as the whole utterance — so one throw took the sentence
 * with it, and the coach looked like a browser with no speech at all. A voice is an accent, not a
 * requirement, and this holds it to that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUE_LIMIT, announce, canSpeak, hush, say } from './speech';

interface Spoken {
  text: string;
  voice?: unknown;
  lang?: string;
  onend?: (() => void) | null;
  onerror?: (() => void) | null;
}

/** Install a fake synthesiser. `voices` decides what `getVoices` returns; `rejects` makes the
 *  `voice` setter throw, which is what a real browser does for a foreign object. */
function stub(opts: { voices?: unknown[]; rejects?: boolean } = {}): {
  said: Spoken[];
  cancels: number;
  /** Fire `onend` on the line currently being spoken, as a browser would. */
  end: () => void;
} {
  const said: Spoken[] = [];
  const state = { cancels: 0 };
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => opts.voices ?? [],
    cancel: () => {
      state.cancels++;
    },
    speak: (u: Spoken) => said.push(u),
  });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      #voice: unknown = null;
      constructor(t: string) {
        this.text = t;
      }
      set voice(v: unknown) {
        if (opts.rejects) throw new TypeError('not a SpeechSynthesisVoice');
        this.#voice = v;
      }
      get voice(): unknown {
        return this.#voice;
      }
    },
  );
  return {
    said,
    get cancels() {
      return state.cancels;
    },
    end: () => {
      const last = said[said.length - 1] as (Spoken & { onend?: () => void }) | undefined;
      last?.onend?.();
    },
  };
}

// The queue is module state, so a line left half-spoken by one test would be waiting in the next.
beforeEach(() => hush());
afterEach(() => {
  hush();
  vi.unstubAllGlobals();
});

describe('speaking', () => {
  it('says the sentence', () => {
    const s = stub();
    say('Drawing from the stock.');
    expect(s.said.map((u) => u.text)).toEqual(['Drawing from the stock.']);
  });

  it('STILL says it when the browser refuses the voice', () => {
    // The bug this file exists for. A voice is an accent; losing it must not lose the words.
    const s = stub({ voices: [{ lang: 'en-GB', localService: true }], rejects: true });
    say('Laying down nines and aces.');
    expect(s.said.map((u) => u.text)).toEqual(['Laying down nines and aces.']);
  });

  it('QUEUES rather than cutting the last line off', () => {
    // The bug: each new line cancelled the one being spoken, so a burst of events came out as
    // fragments — "Drawing from the sto—", a scrap of something else, then silence.
    const s = stub();
    say('one');
    say('two');
    say('three');
    // Only the first is speaking; the rest are waiting their turn.
    expect(s.said.map((u) => u.text)).toEqual(['one']);
    s.end();
    expect(s.said.map((u) => u.text)).toEqual(['one', 'two']);
    s.end();
    expect(s.said.map((u) => u.text)).toEqual(['one', 'two', 'three']);
  });

  it('drops the OLDEST when the table outruns the voice', () => {
    // Being told what happened four moves ago, while the table waits on you, is worse than not
    // being told. The queue is short and the newest lines win.
    const s = stub();
    const burst = Array.from({ length: QUEUE_LIMIT + 4 }, (_, i) => String(i + 1));
    for (const t of burst) say(t);
    const heard = [s.said[0]!.text];
    for (let i = 0; i < burst.length; i++) {
      s.end();
      if (s.said.length > heard.length) heard.push(s.said[s.said.length - 1]!.text);
    }
    expect(heard[0], 'the line already being spoken was cut off').toBe('1');
    expect(heard.at(-1), 'the newest line was dropped').toBe(burst.at(-1));
    expect(heard.length, 'the whole burst was read out despite the cap').toBeLessThan(burst.length);
  });

  it('keeps going when the browser forgets to say a line has ended', () => {
    // Chrome drops `onend` often enough that a queue trusting it wedges for good — which is the
    // other half of "it says one thing and stops".
    vi.useFakeTimers();
    const s = stub();
    say('first');
    say('second');
    expect(s.said).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(s.said.map((u) => u.text)).toEqual(['first', 'second']);
    vi.useRealTimers();
  });

  it('forgets what was waiting when it is hushed', () => {
    const s = stub();
    say('one');
    say('two');
    hush();
    expect(s.cancels).toBeGreaterThan(0);
    s.end();
    expect(s.said.map((u) => u.text)).toEqual(['one']);
  });

  it('says nothing about nothing', () => {
    const s = stub();
    say('');
    say('   ');
    expect(s.said).toHaveLength(0);
  });

  it('is quiet, not broken, in a browser that cannot speak', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(canSpeak()).toBe(false);
    expect(() => say('anything')).not.toThrow();
    expect(() => hush()).not.toThrow();
  });

  it('is quiet, not broken, when the synthesiser itself throws', () => {
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => {
        throw new Error('blocked');
      },
      cancel: () => {},
      speak: () => {
        throw new Error('blocked');
      },
    });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    expect(() => say('anything')).not.toThrow();
  });
});

/**
 * ANNOUNCEMENTS ARE NOT CHATTER.
 *
 * The score at the end of a round is four sentences into a queue two deep, so as ordinary lines
 * three of them were thrown away — a player heard "Pile Hawk went out" and never heard by how much.
 * And when the next round dealt a moment later, its own announcement hushed what was left of the
 * first one mid-sentence.
 */
describe('announcements', () => {
  it('are said whole, however many lines and however short the queue', () => {
    const s = stub();
    announce(['one', 'two', 'three', 'four']);
    const heard = [s.said[0]!.text];
    for (let i = 0; i < 4; i++) {
      s.end();
      if (s.said.length > heard.length) heard.push(s.said[s.said.length - 1]!.text);
    }
    expect(heard).toEqual(['one', 'two', 'three', 'four']);
  });

  it('clear the chatter waiting behind them', () => {
    // A round ending makes everything queued before it irrelevant.
    const s = stub();
    say('chatter one');
    say('chatter two');
    announce(['the score']);
    s.end();
    expect(s.said.map((u) => u.text)).toEqual(['chatter one', 'the score']);
  });

  it('do NOT clear another announcement', () => {
    // A round ends and the next deals a moment later. The second announcement used to hush the
    // first mid-sentence, which is how three quarters of the score summary went missing.
    const s = stub();
    announce(['went out', 'you scored 780', 'you are on 2340']);
    announce(['round 3, you are ahead']);
    const heard = [s.said[0]!.text];
    for (let i = 0; i < 4; i++) {
      s.end();
      if (s.said.length > heard.length) heard.push(s.said[s.said.length - 1]!.text);
    }
    expect(heard).toEqual(['went out', 'you scored 780', 'you are on 2340', 'round 3, you are ahead']);
  });

  it('survive commentary arriving while they are still being said', () => {
    // The next round's moves start landing before the summary has finished. They must not evict it.
    const s = stub();
    announce(['went out', 'you scored 780', 'you are on 2340']);
    for (const t of ['Melder draws', 'Melder discards', 'Pile Hawk draws', 'Pile Hawk melds']) say(t);
    const heard = [s.said[0]!.text];
    for (let i = 0; i < 8; i++) {
      s.end();
      if (s.said.length > heard.length) heard.push(s.said[s.said.length - 1]!.text);
    }
    expect(heard.slice(0, 3), 'the summary was cut short by chatter').toEqual([
      'went out',
      'you scored 780',
      'you are on 2340',
    ]);
  });

  it('are forgotten when the coach is switched off', () => {
    const s = stub();
    announce(['one', 'two', 'three']);
    hush();
    s.end();
    expect(s.said.map((u) => u.text)).toEqual(['one']);
  });
});
