import type { WhoIsWho as Roster } from '../lib/whoIsWho';

/**
 * WHO IS PLAYING AND WHO IS TALKING TO YOU.
 *
 * Four different things sit at one of these tables — people, A2A agents taking turns, the room's
 * own built-in coach, and an A2A agent you named to advise you — and nothing on the screen told them
 * apart. "I cannot see which ones are playing vs coaches vs agent coaches from a2a and my llm's."
 *
 * So it is said plainly, in one list, with what is BEHIND each agent: a rules table or a language
 * model. And when the agent advising you is also one of the players, that is said first, because it is
 * a real thing to know and not something anybody should have to work out from two names matching.
 */
export function WhoIsWhoPanel({ roster }: { roster: Roster }) {
  const { playing, coach } = roster;
  return (
    <details className="who-is-who">
      <summary>Who is who at this table</summary>

      {/* THE COACH FIRST, because "who is answering me?" is the question this panel is inside. */}
      <p className={`who-coach${coach.kind === 'agent' && coach.alsoPlaying ? ' conflict' : ''}`}>
        <span className={`who-tag ${coach.kind === 'house' ? 'house' : 'adviser'}`}>
          {coach.kind === 'house' ? 'house coach' : 'your adviser'}
        </span>
        <strong>{coach.label}</strong> — {coach.what}
      </p>

      <ul className="who-seats">
        {playing.map((s) => (
          <li key={s.seat}>
            <span className={`who-tag ${s.kind}`}>
              {s.kind === 'you' ? 'you' : s.kind === 'person' ? 'person' : 'a2a agent'}
            </span>
            <strong>{s.name}</strong>
            {s.agentName ? <code>{s.agentName}</code> : null}
            {s.behind ? <span className="hint">{s.behind}</span> : null}
            {s.sittingOut ? <span className="hint">sitting out</span> : null}
          </li>
        ))}
      </ul>

      <p className="hint">
        Everyone in this list takes turns. A coach never does — it answers you, and you play the move
        or you do not.
      </p>
    </details>
  );
}
