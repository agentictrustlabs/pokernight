import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MISSION_COVENANT_CLAUSES, PRESENCE_LIMITS, countryCeiling, displayPoint, type CountryCeiling } from '@pokernight/missions';
import { api, ApiError } from '../lib/api';
import { NameCheck, useNameCheck } from '../components/NameCheck';
import { startMissionRegistration, type AuthConfig } from '../lib/home';
import { MISSIONS_HASH } from '../lib/routes';
import type { AppSession } from '../lib/types';

interface Place { label: string; country: string; lat: number; lng: number; kind: string }

/**
 * REGISTER A MISSION (docs/MISSION-REGISTRY.md §2.1). The form is the presence — name, what it does, website,
 * languages, a place — the three clauses, and the operators' contact. Nothing is sent to the room from
 * here: the button takes the steward to their Home, which chooses or creates the organization, has them
 * sign the covenant, has the organization sign its entry on chain, and brings them back; the room's
 * return leg then verifies and admits. What is drawn here is what will be published, and the ceiling is
 * shown before it is signed — a mission in a country whose ceiling hides the point is told so, not surprised.
 */
export function MissionRegisterPage({ session, config }: { session: AppSession | null; config: AuthConfig | null }) {
  const [name, setName] = useState('');
  const [blurb, setBlurb] = useState('');
  const [website, setWebsite] = useState('https://');
  const [languages, setLanguages] = useState('en');
  const [contact, setContact] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [precise, setPrecise] = useState(true);
  const [clauses, setClauses] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);
  const nameCheck = useNameCheck(config, name, 'org');

  // The geocoder, on a debounce, through the room (the browser names one origin).
  useEffect(() => {
    if (place && query === place.label) return;
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (query.trim().length < 3) { setHits([]); return; }
    searchTimer.current = window.setTimeout(() => {
      api.geocode(query.trim(), session?.token).then((r) => setHits(r.places)).catch(() => setHits([]));
    }, 350);
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current); };
  }, [query, place, session?.token]);

  const ceiling: CountryCeiling | null = place ? countryCeiling(place.country) : null;
  const shown = place ? displayPoint({ country: place.country, lat: place.lat, lng: place.lng, precise }) : null;
  const allAffirmed = MISSION_COVENANT_CLAUSES.every((c) => clauses[c.id]);
  const langs = languages.split(/[,\s]+/).map((l) => l.trim().toLowerCase()).filter(Boolean);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setErr(null);
    if (!name.trim()) return setErr('Name the mission.');
    if (!blurb.trim()) return setErr('Say what the mission does.');
    if (!/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(website)) return setErr('The website must be an https:// address.');
    if (!place) return setErr('Pick the place from the list — the country decides what may be shown.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return setErr('The contact must be an email address (for the room’s operators only).');
    if (!allAffirmed) return setErr('Affirm all three clauses of the covenant.');
    setBusy(true);
    try {
      location.href = await startMissionRegistration(config, {
        name: name.trim(), blurb: blurb.trim(), website: website.trim(), languages: langs.length ? langs.slice(0, PRESENCE_LIMITS.languages) : ['en'],
        place: { label: place.label, country: place.country, lat: place.lat, lng: place.lng, precise },
        clauseIds: MISSION_COVENANT_CLAUSES.map((c) => c.id), contact: contact.trim(),
      });
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : ex instanceof Error ? ex.message : 'Could not start the registration.');
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Missions</span>
          <h1>Register a mission</h1>
        </div>
        <p className="lede">What you write here is what the map shows. Your Home does the rest in one trip: the organization, the covenant, the entry — and brings you straight back.</p>
      </header>

      {/* A MISSION STEWARD'S OWN ONBOARDING (2026-09-14): a visitor registering a mission is not here to play, and
          used to be sent through the room's sign-in — play money, a buy-in limit, a seat. Now the form is open,
          and the ONE trip is to their Home: sign in there (or make a Home), choose or create the organization, sign
          the covenant, the organization signs its entry — and the room signs them in as it admits the mission.
          No coach, no money account, no seat is set up for them. */}
      {!session ? (
        <section className="panel mission-onboarding">
          <h2 className="eyebrow-h">How registering works</h2>
          <ol>
            <li><strong>Say what the mission is</strong> — below. Its name, what it does, where it is, how the room reaches you.</li>
            <li><strong>Go to your Home.</strong> Your Home is your own account on the faithnet estate — sign in there, or make one on the way (an email address or a social account; nothing to install). The organization is created there, in your custody, or you pick one you already steward.</li>
            <li><strong>Two signatures.</strong> The covenant, as you; the registry entry, as the organization. Then you are back here, with the mission on the map.</li>
          </ol>
          <p className="hint">Registering makes you no player: no play money, no seat, no coach are set up for you. A game night invites your mission as its guest; your people join the talk, and giving is a separate choice — never a condition of anything here.</p>
        </section>
      ) : null}

      <form className="panel mission-form" onSubmit={submit}>
        <h2>The mission</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, PRESENCE_LIMITS.name))} placeholder="Hope for the City" autoComplete="organization" required />
          <span className="hint">Also the organization’s name at your Home, if it is created there tonight.</span>
          <NameCheck check={nameCheck} what="organization" />
        </label>
        <label>
          What it does
          <textarea value={blurb} onChange={(e) => setBlurb(e.target.value.slice(0, PRESENCE_LIMITS.blurb))} rows={4} placeholder="Two sentences a host would read out at the table." required />
          <span className="hint">{blurb.length}/{PRESENCE_LIMITS.blurb}</span>
        </label>
        <div className="mission-two">
          <label>
            Website
            <input value={website} onChange={(e) => setWebsite(e.target.value.slice(0, PRESENCE_LIMITS.website))} inputMode="url" required />
          </label>
          <label>
            Languages
            <input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="en, es" />
            <span className="hint">Language tags, comma-separated.</span>
          </label>
        </div>

        <h2>Where it is</h2>
        <label>
          Place
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPlace(null); }} placeholder="City or town, then pick from the list" autoComplete="off" />
        </label>
        {hits.length > 0 && !place ? (
          <ul className="mission-hits">
            {hits.map((h, i) => (
              <li key={`${h.label}-${i}`}>
                <button type="button" onClick={() => { setPlace(h); setQuery(h.label); setHits([]); }}>{h.label} <span className="hint">{h.country}</span></button>
              </li>
            ))}
          </ul>
        ) : null}
        {place ? (
          <div className="mission-ceiling">
            <p>
              <strong>{place.label}</strong> · {place.country}
            </p>
            {ceiling === 'none' ? (
              <p className="form-warn">In {place.country} the room shows no location at all — the mission is listed by name and country. That is the ceiling for the country, whatever you choose below.</p>
            ) : ceiling === 'adm2' ? (
              <p className="form-warn">In {place.country} the room shows the region only, never the point. The exact place stays in your organization’s vault.</p>
            ) : (
              <label className="check">
                <input type="checkbox" checked={precise} onChange={(e) => setPrecise(e.target.checked)} />
                Show the exact point on the map. Unticked, the map shows “near here” — within a few kilometres.
              </label>
            )}
            {shown ? <p className="hint">Shown as: {shown.grain === 'hidden' ? 'name and country only' : shown.grain === 'exact' ? 'the exact point' : shown.grain === 'nearby' ? 'a point within a few kilometres' : 'the region'}.</p> : null}
          </div>
        ) : null}

        <h2>The covenant</h2>
        <p className="hint">You affirm these as the person authorised to act for the mission. You sign them at your Home, in the mission’s name and this registry’s.</p>
        {MISSION_COVENANT_CLAUSES.map((c, i) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={!!clauses[c.id]} onChange={(e) => setClauses((s) => ({ ...s, [c.id]: e.target.checked }))} />
            <span><strong>{i + 1}.</strong> {c.text}</span>
          </label>
        ))}

        <h2>For the room’s operators</h2>
        <label>
          Contact email
          <input value={contact} onChange={(e) => setContact(e.target.value)} inputMode="email" autoComplete="email" required />
          <span className="hint">Never shown, never on the map, never on chain. Kept at your organization’s vault and at the room’s desk.</span>
        </label>

        {err ? <div className="form-error">{err}</div> : null}
        <div className="row">
          <button className="primary" type="submit" disabled={busy || !config}>{busy ? 'Going to your Home…' : 'Register at my Home'}</button>
          {nameCheck.state === 'taken' ? <span className="hint">If that organization is already yours, keep this name — your Home will offer it to you on the way — or pick another.</span> : null}
          <a className="small" href={MISSIONS_HASH}>Back to the map</a>
        </div>
        <p className="hint">Your Home asks which organization this is — one you already steward, or a new one it creates — then two signatures: the covenant as you, the entry as the organization.</p>
      </form>
    </div>
  );
}
