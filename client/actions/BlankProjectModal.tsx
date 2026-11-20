'use client';
import { useState } from 'react';
import { nowIso, api, closeModal, S, toast } from '../core';
import { Modal } from '../ui';
import { TF } from '../fields';

export function BlankProjectModal() {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [touched, setTouched] = useState(false);
  const autoKey = (n: string) =>
    n
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 4)
      .toUpperCase();
  return (
    <Modal
      title="Create a blank project"
      actions={[
        { label: 'Cancel' },
        {
          label: 'Create',
          kind: 'primary',
          disabled: !name.trim(),
          onClick: async () => {
            const k = (key || autoKey(name) || 'PRJ').replace(/[^a-z0-9]/gi, '').toUpperCase();
            const now = nowIso();
            try {
              const p = await api('/api/projects', {
                method: 'POST',
                body: {
                  name: name.trim(),
                  key: k,
                  summary: '',
                  assumptions: [],
                  openQuestions: [],
                  sourceName: '',
                  sourceText: '',
                  epics: [],
                  tickets: [],
                  createdAt: now,
                  updatedAt: now,
                },
              });
              closeModal();
              S.nav(`/p/${p.id}/backlog`);
            } catch (e: any) {
              toast(e.message, 'err');
            }
          },
        },
      ]}
    >
      <label className="field">
        <span>
          Name <span className="req">*</span>
        </span>
        <TF
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!touched) setKey(autoKey(e.target.value));
          }}
          placeholder="e.g. Mobile app relaunch"
        />
      </label>
      <label className="field">
        <span>
          Key <span className="req">*</span>
        </span>
        <TF
          maxLength={8}
          value={key}
          onChange={(e) => {
            setTouched(true);
            setKey(e.target.value.toUpperCase());
          }}
          placeholder="e.g. MAR"
        />
      </label>
    </Modal>
  );
}
