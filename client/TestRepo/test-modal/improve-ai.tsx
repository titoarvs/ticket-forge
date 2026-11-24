'use client';
// Improve with AI: the AI rewrites the draft to the company's test standard (or as asked). Nothing
// is saved until Save.
import { useState } from 'react';
import { type Any, P, uid, toast, api, aiBody } from '../../core';
import { Ico, I } from '../../ui';
import { TF } from '../../fields';
import type { Draft } from './draft';

export function ImproveWithAi({ test, draft }: { test: Any | null; draft: Draft }) {
  const { d, setD } = draft;
  const [ask, setAsk] = useState('');
  const [improving, setImproving] = useState(false);
  const improve = async () => {
    if (!d.title.trim()) return toast('Give the test a title first.', 'err');
    setImproving(true);
    try {
      const out = await api(`/api/projects/${P().id}/testrepo-ai`, {
        method: 'POST',
        body: aiBody({
          action: 'improve',
          test: { ...d, key: test?.key },
          instruction: ask.trim(),
        }),
      });
      setD({
        ...d,
        ...out.test,
        steps: (out.test.steps || []).map((st: Any) => ({ id: uid(), ...st })),
        labels: out.test.labels?.length ? out.test.labels : d.labels,
      });
      toast(out.changes || 'Rewritten to your test standard. Review, then save.', 'ok', {
        title: 'Test improved',
      });
      setAsk('');
    } catch (e: Any) {
      toast(`Couldn’t improve the test: ${e.message}`, 'err');
    } finally {
      setImproving(false);
    }
  };
  return (
    <div className="xr-improve">
      <TF
        value={ask}
        placeholder="Improve with AI: e.g. convert to Gherkin, add the negative case, split the data out (optional)"
        onChange={(e) => setAsk(e.target.value)}
        onKeyDown={(e: Any) => {
          if (e.key === 'Enter') improve();
        }}
        sx={{ flex: 1 }}
      />
      <button className="btn sm ai" disabled={improving} onClick={improve}>
        {improving ? (
          'Improving…'
        ) : (
          <>
            <Ico svg={I.sparkle} />
            Improve with AI
          </>
        )}
      </button>
    </div>
  );
}
