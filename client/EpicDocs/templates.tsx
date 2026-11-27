'use client';
// The templates the epic documents follow. In Administration → Generation they are the team's; in
// Project settings → Templates (`project`) they are the project's own, falling back to the team's.
// The Problem Statement template is a Word document; the Feature Brief and Architecture Record
// Design templates are Markdown.
import { useEffect, useRef, useState } from 'react';
import { P, api, saveBlob, toast, openModal, ago, type Any } from '../core';
import { Ico, I, Spinner, Confirm } from '../ui';
import { Markdown } from '../GuideCard';

/** Drops embedded bold font files the template doesn't use, so it fits upload limits. */
async function trimmed(file: File) {
  const [{ default: JSZip }, { trimEmbeddedFonts }] = await Promise.all([
    import('jszip'),
    import('../../lib/docx-fonts'),
  ]);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  await trimEmbeddedFonts(zip);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return new File([blob], file.name);
}

function PsdTemplateFound({ t, project }: { t: Any; project: boolean }) {
  const info = t.info || {};
  return (
    <div style={{ minWidth: 0 }}>
      <b>{t.name}</b>
      {project && (
        <span className="label-chip" style={{ marginLeft: 6 }}>
          {t.scope === 'project' ? 'This project' : 'Team template'}
        </span>
      )}
      <div className="muted small">
        {(t.bytes / 1048576).toFixed(1)} MB · uploaded {ago(t.updatedAt)}
        {t.updatedBy ? ` by ${t.updatedBy}` : ''}
      </div>
      <div className="muted small">
        Found: cover “{info.coverTitle || '—'}”, {info.sections?.length || 0} sections,{' '}
        {info.tables || 0} tables{info.backMatter ? ', Document Control and Sign-off' : ''}. The
        product name, feature name, version and status are replaced in each PSD; sign-off names and
        signatures are left empty.
      </div>
    </div>
  );
}

/** The .docx template PSDs are built from. */
export function PsdTemplateCard({
  project = false,
  ed = true,
}: {
  project?: boolean;
  ed?: boolean;
}) {
  const endpoint = project ? `/api/projects/${P().id}/templates/psd` : '/api/admin/psd-template';
  const [t, setT] = useState<Any>(undefined);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api(endpoint)
      .then((d) => setT(d.template))
      .catch(() => setT(null));
  }, [endpoint]);
  const upload = async (file?: File) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) return toast('Upload a Word document (.docx).', 'err');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', await trimmed(file));
      const d = await api(endpoint, { method: 'PUT', body: fd });
      setT(d.template);
      toast(`Template saved. New Problem Statements${project ? ' in this project' : ''} use it.`);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const own = t && (!project || t.scope === 'project');
  const remove = () =>
    openModal(
      <Confirm
        title={project ? 'Use the team’s template?' : 'Remove the template?'}
        label={project ? 'Use team template' : 'Remove'}
        text={
          project
            ? 'New Problem Statements in this project use the team’s template (or the plain layout if there is none).'
            : 'New PSDs use the plain layout until you upload another.'
        }
        onYes={async () => setT((await api(endpoint, { method: 'DELETE' })).template)}
      />,
    );
  const uploadBtn = (label: string, primary = false) =>
    ed && (
      <button
        className={`btn ${primary ? 'primary' : 'sm'}`}
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? <Spinner /> : <Ico svg={I.upload} />}
        {busy ? 'Uploading…' : label}
      </button>
    );
  return (
    <div className="card wide">
      <h3>Problem Statement template</h3>
      <p className="sub">
        The Word document each epic’s Problem Statement (PSD) is built from: its cover, logo,
        styles, fonts, header and footer are kept, and the AI’s content fills its sections and
        tables.{' '}
        {project
          ? 'This project uses the team’s template unless you upload its own.'
          : 'Without one, PSDs use a plain layout with the same sections.'}
      </p>
      {t === undefined ? (
        <span className="muted small">
          <Spinner /> Loading…
        </span>
      ) : t ? (
        <div className="psd-tpl">
          <Ico svg={I.doc} />
          <PsdTemplateFound t={t} project={project} />
          <span className="spacer" />
          {own && (
            <a className="btn sm" href={`${endpoint}?download=1`}>
              <Ico svg={I.download} />
              Download
            </a>
          )}
          {uploadBtn(own ? 'Replace' : 'Upload for this project')}
          {ed && own && (
            <button
              className="icon-btn"
              title="Remove"
              aria-label="Remove template"
              onClick={remove}
            >
              <Ico svg={I.trash} />
            </button>
          )}
        </div>
      ) : (
        <>
          {project && (
            <p className="muted small" style={{ marginTop: 0 }}>
              No template yet: Problem Statements use the plain layout.
            </p>
          )}
          {uploadBtn('Upload template (.docx)', true)}
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".docx"
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

type MdProps = {
  endpoint: string;
  title: string;
  doc: string;
  intro: string;
  project?: boolean;
  ed?: boolean;
};
/** A Markdown template a document follows (Feature Brief, Architecture Record Design). */
export function MdTemplateCard({
  endpoint,
  title,
  doc,
  intro,
  project = false,
  ed = true,
}: MdProps) {
  const [t, setT] = useState<Any>(undefined);
  const [show, setShow] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api(endpoint)
      .then((d) => setT(d.template))
      .catch(() => setT(null));
  }, [endpoint]);
  const upload = async (file?: File) => {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name))
      return toast('Upload a Markdown file (.md).', 'err');
    try {
      const body = { text: await file.text(), name: file.name };
      const d = await api(endpoint, { method: 'PUT', body });
      setT(d.template);
      toast(`Template saved. New ${doc}s${project ? ' in this project' : ''} follow it.`);
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };
  const fallback = project ? 'the team’s template' : 'the default template';
  const chip = !t
    ? ''
    : t.scope === 'project'
      ? 'This project'
      : t.scope === 'team'
        ? project
          ? 'Team template'
          : ''
        : 'Default';
  const reset = () =>
    openModal(
      <Confirm
        title={`Go back to ${fallback}?`}
        label="Switch back"
        text={`New ${doc}s${project ? ' in this project' : ''} follow ${fallback}. Documents already written don’t change.`}
        onYes={async () => setT((await api(endpoint, { method: 'DELETE' })).template)}
      />,
    );
  return (
    <div className="card wide">
      <h3>{title}</h3>
      <p className="sub">{intro}</p>
      {t === undefined ? (
        <span className="muted small">
          <Spinner /> Loading…
        </span>
      ) : t === null ? (
        <span className="muted small">Couldn’t load the template.</span>
      ) : (
        <div className="psd-tpl">
          <Ico svg={I.doc} />
          <div style={{ minWidth: 0 }}>
            <b>{t.name}</b>
            {chip && (
              <span className="label-chip" style={{ marginLeft: 6 }}>
                {chip}
              </span>
            )}
            <div className="muted small">
              {t.sections.length} sections: {t.sections.join(' · ')}
            </div>
            {t.updatedAt && (
              <div className="muted small">
                Uploaded {ago(t.updatedAt)}
                {t.updatedBy ? ` by ${t.updatedBy}` : ''}
                {project && t.scope === 'team' ? ' in Administration' : ''}
              </div>
            )}
          </div>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Preview'}
          </button>
          <button
            className="btn sm"
            onClick={() => saveBlob(new Blob([t.text], { type: 'text/markdown' }), t.name)}
          >
            <Ico svg={I.download} />
            Download
          </button>
          {ed && (
            <button className="btn sm" onClick={() => fileRef.current?.click()}>
              <Ico svg={I.upload} />
              {t.custom ? 'Replace' : project ? 'Upload for this project' : 'Upload your own'}
            </button>
          )}
          {ed && t.custom && (
            <button className="btn sm subtle" onClick={reset}>
              {project ? 'Use team template' : 'Use default'}
            </button>
          )}
        </div>
      )}
      {show && t && (
        <div className="guide-preview" style={{ marginTop: 10 }}>
          <Markdown text={t.text.replace(/<!--[\s\S]*?-->/g, '')} />
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".md,.markdown,.txt"
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

const FBD_INTRO =
  'The Markdown template each epic’s Feature Brief (FBD) fills in: the AI keeps its headings and tables and replaces the [bracketed prompts].';
const ARD_INTRO =
  'The Markdown template each epic’s Architecture Record Design (ARD) fills in: the AI keeps its headings, tables and IDs (AD-xx, AS-xx, Qxx) and replaces the [bracketed prompts].';
const TEAM = ' Your team’s template is the default; upload another to change it for every project.';
const OWN = ' This project uses the team’s template unless you upload its own.';

/** Administration → Generation → Documents: the team's three templates. */
export function TeamTemplateCards() {
  return (
    <>
      <PsdTemplateCard />
      <MdTemplateCard
        endpoint="/api/admin/fbd-template"
        title="Feature Brief template"
        doc="Feature Brief"
        intro={FBD_INTRO + TEAM}
      />
      <MdTemplateCard
        endpoint="/api/admin/ard-template"
        title="Architecture Record Design template"
        doc="Architecture Record Design"
        intro={ARD_INTRO + TEAM}
      />
    </>
  );
}

/** Project settings → Templates: the project's own three templates. */
export function ProjectTemplateCards({ ed }: { ed: boolean }) {
  const base = `/api/projects/${P().id}/templates`;
  return (
    <>
      <PsdTemplateCard project ed={ed} />
      <MdTemplateCard
        project
        ed={ed}
        endpoint={`${base}/fbd`}
        title="Feature Brief template"
        doc="Feature Brief"
        intro={FBD_INTRO + OWN}
      />
      <MdTemplateCard
        project
        ed={ed}
        endpoint={`${base}/ard`}
        title="Architecture Record Design template"
        doc="Architecture Record Design"
        intro={ARD_INTRO + OWN}
      />
    </>
  );
}
