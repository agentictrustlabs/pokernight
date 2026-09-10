/**
 * Reading a sentence out loud.
 *
 * `speechSynthesis` is in every browser this site runs in, ships nothing, and needs no key — so a
 * coach that talks costs one file and no assets. That is the whole reason to use it rather than
 * generating audio somewhere.
 *
 * THREE RULES, all about not being the thing people mute.
 *
 * 1. IT IS OFF UNTIL ASKED. A page that starts talking at somebody who did not ask is a page they
 *    close. Nothing here speaks until the coach is switched on, which is a real click.
 * 2. ONE SENTENCE AT A TIME. A canasta turn passes quickly, and a queue of stale narration talking
 *    over the current move is worse than silence — so a new line CANCELS the old one rather than
 *    joining a queue behind it.
 * 3. IT NEVER BLOCKS ANYTHING. Every call is wrapped; a browser with no voices, a locked-down
 *    context, a synthesiser that throws — all of them end with the game still playable and quiet.
 *
 * A voice is chosen once and kept, because a coach that changes voice mid-round sounds like two
 * people disagreeing.
 */

const VOICE_KEY = 'pokernight.voice';
const RATE_KEY = 'pokernight.voice.rate';

let picked: SpeechSynthesisVoice | null = null;
let looked = false;

function synth(): SpeechSynthesis | null {
  try {
    return typeof speechSynthesis === 'undefined' ? null : speechSynthesis;
  } catch {
    return null;
  }
}

/** Whether this browser can talk at all. False is an ordinary answer, not a failure. */
export function canSpeak(): boolean {
  return synth() !== null;
}

function read(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a browser that will not remember still speaks for this tab */
  }
}

/**
 * Every English voice this browser has, best first.
 *
 * ORDER IS THE WHOLE POINT. Browsers ship one flat, robotic default and a handful of much better
 * ones behind it, and which is which is not in the API — but the names are a reliable tell, and a
 * NON-local voice is almost always the good one (it is synthesised on a server by a better model).
 * A coach nobody can understand is a coach that gets turned off, so this sorts rather than takes
 * the first thing offered, and the person can override it.
 */
export function voices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  let all: SpeechSynthesisVoice[] = [];
  try {
    all = s.getVoices();
  } catch {
    return [];
  }
  if (all.length > 0) looked = true;
  const english = all.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  const rank = (v: SpeechSynthesisVoice): number => {
    const n = `${v.name}`.toLowerCase();
    // The names browsers give their better voices. Not a guess: these are the neural ones.
    if (/natural|neural|premium|enhanced|siri|google/.test(n)) return 0;
    if (!v.localService) return 1;
    if (/samantha|daniel|karen|moira|serena|alex|fiona/.test(n)) return 2;
    return 3;
  };
  return english.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The chosen voice's name, or empty for "whichever this browser thinks is best". */
export function voiceName(): string {
  return read(VOICE_KEY);
}

export function setVoiceName(name: string): void {
  write(VOICE_KEY, name);
  picked = null;
}

/** How fast it talks. 1 is the browser's normal; the default here is slower, because a RULE read at
 *  speed is a rule nobody catches. */
export function rate(): number {
  const n = Number(read(RATE_KEY, ''));
  return Number.isFinite(n) && n >= 0.5 && n <= 1.5 ? n : 0.9;
}

export function setRate(n: number): void {
  write(RATE_KEY, String(n));
}

/** The voice to use: the chosen one if it is still here, else the best this browser has. */
function voice(): SpeechSynthesisVoice | null {
  if (picked) return picked;
  const all = voices();
  if (all.length === 0) return null;
  const want = voiceName();
  picked = (want ? all.find((v) => v.name === want) : null) ?? all[0] ?? null;
  return picked;
}

/* ------------------------------------------------------------------ the queue */

/**
 * COMMENTARY IS A SEQUENCE, NOT A STATUS.
 *
 * The first version cancelled whatever was being said and started the new line. That is right for
 * one sentence about the current state, and wrong for narration: a table produces several events in
 * a burst — a player melds twice and discards — and cancel-and-replace turns that into fragments,
 * each cut off by the next. What you hear is "Drawing from the sto—", then a scrap of something
 * else, then silence.
 *
 * So lines QUEUE and are spoken in order. Two limits keep that from becoming a monologue:
 *
 *   the queue is short, and OVERFLOW DROPS THE OLDEST. Stale narration is worse than missing
 *   narration — being told what happened four moves ago while the table waits on you is confusing
 *   in a way that silence is not.
 *
 *   every line has a watchdog. Chrome drops `onend` often enough that a queue trusting it wedges
 *   permanently, which is the other half of "it says one thing and stops".
 */
/**
 * A line waiting to be said, and whether it may be thrown away.
 *
 * `keep` is the difference between a running commentary and an announcement. Commentary is dropped
 * freely — being told what happened three moves ago is worse than not being told. An announcement
 * is the score at the end of a round or the standings at the start of one, and dropping half of it
 * leaves a player who heard "Pile Hawk went out" and never heard by how much.
 */
interface Line {
  text: string;
  keep: boolean;
}

const queue: Line[] = [];
/**
 * How many ORDINARY lines may wait. Announcements are not counted and are never trimmed.
 *
 * Two, because being in step with the table matters more than saying everything. When the table
 * outruns the voice the oldest ordinary line is the one to lose.
 */
export const QUEUE_LIMIT = 2;
let speaking = false;
/** Whether what is being said right now may be interrupted. An announcement may not. */
let speakingKeep = false;
let watchdog: ReturnType<typeof setTimeout> | null = null;

/** Roughly how long a line takes to say, for the watchdog. Generous: it is a backstop, not a clock. */
function estimateMs(text: string): number {
  return Math.min(16000, 900 + text.length * 75);
}

/**
 * The line currently being spoken, as a token.
 *
 * `onend`, `onerror` and the watchdog can all fire for the SAME line, and each of them used to
 * advance the queue — so one line ending could pull two more off it, one of which was then spoken
 * over the other. The token means only the first of them counts.
 */
let token = 0;

function finished(mine: number): void {
  if (mine !== token) return;
  token++;
  speaking = false;
  speakingKeep = false;
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
  stopKeepAlive();
  pump();
}

/**
 * CHROME STOPS SPEAKING AFTER ABOUT FIFTEEN SECONDS and never says so.
 *
 * A long-standing bug: the synthesiser silently pauses partway through a run, `onend` never fires,
 * and everything after it sits in the queue forever. This is the accepted workaround — nudge it
 * while it believes it is speaking. Harmless in browsers that do not have the bug, because
 * resuming something that is not paused does nothing.
 */
let keepAlive: ReturnType<typeof setInterval> | null = null;

function startKeepAlive(): void {
  stopKeepAlive();
  keepAlive = setInterval(() => {
    const s = synth();
    if (!s) return stopKeepAlive();
    try {
      if (s.speaking && !s.paused) {
        s.pause();
        s.resume();
      }
    } catch {
      /* a browser that will not be nudged is one that did not need it */
    }
  }, 5000);
}

function stopKeepAlive(): void {
  if (keepAlive) clearInterval(keepAlive);
  keepAlive = null;
}

function pump(): void {
  const s = synth();
  if (!s || speaking) return;
  const next = queue.shift();
  if (next === undefined) return;
  speaking = true;
  speakingKeep = next.keep;
  try {
    const u = new SpeechSynthesisUtterance(next.text);
    // THE VOICE IS AN OPTIONAL IMPROVEMENT, NOT A REQUIREMENT. Assigning one can throw — the setter
    // rejects anything that is not a real SpeechSynthesisVoice, and browsers disagree about what
    // `getVoices` hands back and when. Its own try means a bad voice costs the accent, not the
    // sentence; one throw here used to silence the coach entirely.
    let lang = 'en-GB';
    try {
      const v = voice();
      if (v) {
        u.voice = v;
        lang = v.lang || lang;
      }
    } catch {
      /* the default voice says the same words */
    }
    u.lang = lang;
    u.rate = rate();
    u.pitch = 1;
    const mine = token;
    u.onend = () => finished(mine);
    u.onerror = () => finished(mine);
    // Chrome drops `onend` often enough that a queue which trusts it stops for good.
    watchdog = setTimeout(() => finished(mine), estimateMs(next.text));
    startKeepAlive();
    s.speak(u);
  } catch {
    finished(token);
  }
}

/**
 * Say one line of commentary, after whatever is already waiting. Never throws.
 *
 * Ordinary lines are droppable: when the table outruns the voice the oldest waiting one goes, so
 * what is said stays in step with what is on screen. Announcements already queued are untouched.
 */
export function say(text: string): void {
  const t = text.trim();
  if (!synth() || !t) return;
  queue.push({ text: t, keep: false });
  // Trim only the droppable ones, oldest first. An announcement waiting its turn is not chatter to
  // be made room for — losing half a score summary is the bug this whole distinction exists for.
  let ordinary = queue.filter((l) => !l.keep).length;
  while (ordinary > QUEUE_LIMIT) {
    const i = queue.findIndex((l) => !l.keep);
    if (i < 0) break;
    queue.splice(i, 1);
    ordinary--;
  }
  pump();
}

/**
 * SAY THIS, WHOLE — for the few things that must not be dropped.
 *
 * The score at the end of a round and the standings at the start of one. It clears the chatter
 * waiting behind it, because a round ending makes everything queued before it irrelevant — but it
 * never clears ANOTHER announcement. Two announcements arriving together (a round ends, the next
 * deals a moment later) is exactly the case that lost three quarters of the score summary: the
 * second one hushed the first mid-sentence.
 */
export function announce(lines: readonly string[]): void {
  const s = synth();
  if (!s) return;
  const wanted = lines.map((l) => l.trim()).filter(Boolean);
  if (wanted.length === 0) return;
  // Drop the chatter, keep the announcements.
  for (let i = queue.length - 1; i >= 0; i--) if (!queue[i]!.keep) queue.splice(i, 1);
  // …and only interrupt what is being said if it is chatter too.
  if (speaking && !speakingKeep) {
    token++;
    speaking = false;
    speakingKeep = false;
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
    try {
      s.cancel();
    } catch {
      /* nothing to stop */
    }
  }
  for (const text of wanted) queue.push({ text, keep: true });
  pump();
}

/** Stop talking now and forget what was waiting — switching the coach off, or leaving the table. */
export function hush(): void {
  queue.length = 0;
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
  stopKeepAlive();
  token++;
  speaking = false;
  speakingKeep = false;
  try {
    synth()?.cancel();
  } catch {
    /* nothing to stop */
  }
}

/** Warm the voice list on a real gesture, so the first line is not the one that goes unvoiced. */
export function primeVoices(): void {
  if (!looked) voice();
}
