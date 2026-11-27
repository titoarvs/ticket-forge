'use client';
// The whole Problem Statement, readable in the app, in the eight sections of the team's template.
import type { ReactNode } from 'react';
import type { Any } from '../core';

const Table = ({ head, rows }: { head: string[]; rows: ReactNode[][] }) => (
  <div className="psd-tbl-wrap">
    <table className="psd-tbl">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

function Glance({ psd }: { psd: Any }) {
  const g = psd.atAGlance || {};
  const items = [
    ['The problem:', g.problem],
    ['Why it matters:', g.whyItMatters],
    ['Who is affected:', g.whoIsAffected],
    ['What is proposed:', g.whatIsProposed],
  ].filter(([, x]) => x);
  return (
    <>
      <h2>1. At a Glance</h2>
      <ul>
        {items.map(([l, x]) => (
          <li key={l}>
            <b>{l}</b> {x}
          </li>
        ))}
      </ul>
      {psd.definition && (
        <p className="psd-callout">
          <b>{psd.definition.term}</b> {psd.definition.text}
        </p>
      )}
    </>
  );
}

function Problem({ psd }: { psd: Any }) {
  return (
    <>
      <h2>2. Background and Current Situation</h2>
      <p>{psd.background?.context}</p>
      {psd.background?.today?.length > 0 && (
        <>
          <p className="psd-label">What happens today</p>
          <ul>
            {psd.background.today.map((x: string, i: number) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </>
      )}
      <h2>3. Problem Statement</h2>
      <p>{psd.problemStatement}</p>
      {psd.gaps?.length > 0 && (
        <>
          <p className="psd-label">{psd.gapsTitle}</p>
          <Table
            head={['Gap', 'What it means']}
            rows={psd.gaps.map((x: Any) => [
              <b key="g">{x.gap}</b>,
              <>
                <div>{x.meaning}</div>
                {x.examples?.length > 0 && (
                  <ul>
                    {x.examples.map((e: Any, i: number) => (
                      <li key={i}>
                        {e.area && <b>{e.area}: </b>}
                        {e.text}
                      </li>
                    ))}
                  </ul>
                )}
              </>,
            ])}
          />
        </>
      )}
    </>
  );
}

function Impact({ psd }: { psd: Any }) {
  const product = psd.product || 'the business';
  return (
    <>
      <h2>4. Who Is Affected</h2>
      <Table
        head={['Who', psd.relationshipHeader, 'How they are affected']}
        rows={(psd.affected || []).map((x: Any) => [<b key="w">{x.who}</b>, x.relationship, x.how])}
      />
      <h2>5. Impact on {psd.product || 'the Business'} as a Business</h2>
      <Table
        head={['Pain point', 'What happens today', `Consequence for ${product}`]}
        rows={(psd.business || []).map((x: Any) => [
          <b key="p">{x.pain}</b>,
          x.today,
          x.consequence,
        ])}
      />
      <h2>6. Impact on Users</h2>
      {(psd.users || []).map((u: Any) => (
        <section key={u.role}>
          <h3>{u.role}</h3>
          <Table
            head={['When this happens…', 'What they cannot do today', 'Consequence for them']}
            rows={u.rows.map((r: Any) => [r.when, r.cannot, r.consequence])}
          />
        </section>
      ))}
    </>
  );
}

function Close({ psd }: { psd: Any }) {
  return (
    <>
      <h2>7. Cost of Inaction</h2>
      <ul>
        {(psd.costOfInaction || []).map((c: Any, i: number) => (
          <li key={i}>
            {c.lead && <b>{c.lead} </b>}
            {c.text}
          </li>
        ))}
      </ul>
      <h2>8. Evidence Needed for the Problem Gate</h2>
      <Table
        head={['Evidence', 'What it proves', 'Suggested source', 'Status']}
        rows={(psd.evidence || []).map((x: Any) => [
          x.evidence,
          x.proves,
          x.source,
          <span key="s" className={`psd-status ${/^collected/i.test(x.status) ? 'ok' : ''}`}>
            {x.status}
          </span>,
        ])}
      />
    </>
  );
}

export function PsdDocument({ psd }: { psd: Any }) {
  return (
    <article className="psd-doc">
      <header className="psd-cover">
        <h1>{psd.title}</h1>
        <span>PROBLEM STATEMENT</span>
      </header>
      <Glance psd={psd} />
      <Problem psd={psd} />
      <Impact psd={psd} />
      <Close psd={psd} />
    </article>
  );
}
