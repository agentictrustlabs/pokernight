import { useEffect, useState } from 'react';
import { MissionMap } from '../components/MissionMap';
import { api, ApiError, type MissionListing, type MissionReceipt } from '../lib/api';
import { MISSIONS_HASH } from '../lib/routes';

const CHECK_WORDS: Record<string, string> = {
  shape: 'the registration is well-formed',
  'claim-slot': 'the presence and covenant hash to the claims on chain',
  'binding-proof': 'the binding proof matches the entry',
  'authority-proof': 'the organization’s own account registered the entry on chain',
  'card-bundle': 'the steward’s agent accepts the covenant’s signature',
  'derived-type': 'the organization carries an .org name',
  'delegation-live': 'a read grant to the operator',
  publication: 'an agent publication',
  'endpoint-control': 'control of an endpoint',
  'suffix-consistency': 'name suffix against type',
};

/**
 * ONE MISSION: its presence, where it is (as the registry may show it), and the operator's receipt line by line
 * — what was verified, what was not attempted, and when it lapses. A person deciding whether to invite it
 * reads the same evidence the registry did.
 */
export function MissionPage({ entryId }: { entryId: string }) {
  const [data, setData] = useState<{ listing: MissionListing; receipt: MissionReceipt | null; events: Array<{ kind: string; occurredAt: string }> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.mission(entryId).then((r) => alive && setData(r)).catch((e: unknown) => alive && setErr(e instanceof ApiError && e.status === 404 ? 'No such mission is registered.' : 'Could not read the mission.'));
    return () => { alive = false; };
  }, [entryId]);

  if (err) return <section className="panel"><h2>Not found</h2><p className="hint">{err}</p><a className="small" href={MISSIONS_HASH}>← All missions</a></section>;
  if (!data) return <section className="panel"><p className="hint">Reading the registry…</p></section>;
  const m = data.listing;
  const r = data.receipt;
  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Mission · {m.status}</span>
          <h1>{m.name}</h1>
        </div>
        <p className="lede">{m.place.label}{m.orgName ? ` · ${m.orgName}` : ''}</p>
      </header>

      <section className="panel mission-detail">
        <p>{m.blurb}</p>
        <p><a href={m.website} target="_blank" rel="noreferrer">{m.website.replace(/^https?:\/\//, '')}</a>{m.languages.length ? ` · ${m.languages.join(', ')}` : ''}</p>
        {m.point ? <MissionMap missions={[m]} height={260} /> : <p className="hint">Its location is not shown — the country’s ceiling, or the mission’s own choice.</p>}
        <p className="hint">Registered {new Date(m.registeredAt).toLocaleDateString()}{m.expiresAt ? `, until ${new Date(m.expiresAt).toLocaleDateString()}` : ''} · entry <code>{m.entryId}</code></p>
      </section>

      <section className="panel">
        <h2>What the registry checked</h2>
        {r ? (
          <>
            <ul className="mission-checks">
              {r.verified.map((v) => <li key={v.check} className="ok">✓ {CHECK_WORDS[v.check] ?? v.check}</li>)}
              {r.failed.map((f) => <li key={f.check} className="bad">✗ {CHECK_WORDS[f.check] ?? f.check} — {f.reason}</li>)}
              {r.notVerified.map((n) => <li key={n.check} className="skip">– {CHECK_WORDS[n.check] ?? n.check} · not verified ({n.reason})</li>)}
            </ul>
            <p className="hint">Receipt {r.receiptId.slice(0, 18)}… signed by the registry operator <code>{r.proof.signer}</code> on {new Date(r.admittedAt).toLocaleString()}. Anyone may fetch it at <code>/missions/…/receipt</code> and verify the signature against the operator’s agent.</p>
          </>
        ) : <p className="hint">No receipt on file.</p>}
        {data.events.length ? <p className="hint">Log: {data.events.map((e) => `${e.kind.toLowerCase().replace(/_/g, ' ')} (${new Date(e.occurredAt).toLocaleDateString()})`).join(' → ')}</p> : null}
      </section>

      <section className="panel">
        <h2>Invite it</h2>
        <p className="hint">A club’s host names a mission as the guest of a night from the club’s schedule; anyone opening a table can name it as the table’s guest. A guest is shown and introduced — it never holds cards, chips, or a hand in anyone’s money.</p>
        <a className="small" href={MISSIONS_HASH}>← All missions</a>
      </section>
    </div>
  );
}
