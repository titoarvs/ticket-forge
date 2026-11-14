import { MarkdownDoc, headingsOf } from '@/client/markdown';
import { LEGAL, type LegalDoc } from '@/lib/legal';

// One legal document: title, version and date, a table of contents, and the text.
export function LegalPage({ doc }: { doc: LegalDoc }) {
  const d = LEGAL[doc];
  const toc = headingsOf(d.body);
  return (
    <article className="legal">
      <p className="legal-note" role="note">Template: this document has placeholders in [brackets] and must be reviewed by qualified counsel before it is relied on.</p>
      <h1>{d.title}</h1>
      <p className="muted small">Version {d.version} · Effective date: [Effective date]</p>
      {toc.length > 2 && <nav className="legal-toc" aria-label="Contents"><b className="small">Contents</b><ol>{toc.map((h) => <li key={h.id}><a href={`#${h.id}`}>{h.title}</a></li>)}</ol></nav>}
      <div className="legal-body"><MarkdownDoc text={d.body} baseLevel={1} /></div>
    </article>
  );
}
