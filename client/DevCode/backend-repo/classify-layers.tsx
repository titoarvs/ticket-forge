'use client';
// How many issues are marked frontend, backend or both, and marking them with AI.
import { type Any, api, P, startTask, aiBody, mutate, setField, can, toast } from '../../core';
import { Spinner, Ico, I } from '../../ui';

/** Asks the AI which layer each issue needs (all, or only the unmarked ones), and sets it. */
async function markLayers(all: boolean, count: number) {
  const task = startTask('Marking issues frontend / backend', {
    detail: `${count} issues`,
    kind: 'ai',
  });
  try {
    const r = await api(`/api/projects/${P().id}/layers`, {
      method: 'POST',
      body: aiBody({ all }),
    });
    const ids = Object.keys(r.layers);
    mutate((pp) => {
      for (const t of pp.tickets)
        if (r.layers[t.id] && t.layer !== r.layers[t.id])
          setField(t, 'layer', r.layers[t.id], 'Claude');
    });
    const n = (l: string) => ids.filter((id) => r.layers[id] === l).length;
    task.finish(`${ids.length} marked`);
    toast(
      `${n('frontend')} frontend · ${n('backend')} backend · ${n('both')} both. Change any issue in its details (Implementation); ⌘Z undoes this.`,
      'ok',
      { title: `${ids.length} issues marked` },
    );
  } catch (e: Any) {
    task.fail(`Couldn’t mark the issues: ${e.message}`);
  }
}

export function ClassifyLayers({ busy, setBusy }: { busy: string; setBusy: (b: string) => void }) {
  const issues = P().tickets.filter((t: Any) => !t.parentId);
  const marked = issues.filter((t: Any) => t.layer).length;
  const classify = async (all: boolean) => {
    setBusy('classify');
    await markLayers(all, all ? issues.length : issues.length - marked);
    setBusy('');
  };
  return (
    <div className="be-classify">
      <span className="small">
        <b>Issues:</b> {marked} of {issues.length} marked frontend, backend or both.
      </span>
      {can('ai.use') && can('issue.edit') && (
        <>
          <button
            className="btn sm ai"
            disabled={!!busy || marked === issues.length}
            onClick={() => classify(false)}
          >
            {busy === 'classify' ? (
              <>
                <Spinner />
                Marking…
              </>
            ) : (
              <>
                <Ico svg={I.sparkle} />
                Mark {issues.length - marked} unmarked with AI
              </>
            )}
          </button>
          {marked > 0 && (
            <button className="btn sm subtle" disabled={!!busy} onClick={() => classify(true)}>
              Re-check all
            </button>
          )}
        </>
      )}
    </div>
  );
}
