'use client';
// Small helpers the issue panel's sections share.
import { type Any, S, mutate, setField, emit } from '../../core';

/** Sets one field of the issue; quick edits to the same field are saved together. */
export const setIssueField = (t: Any, key: string, value: Any) =>
  mutate(() => setField(t, key, value), { tag: `t.${key}${t.id}` });

/** Opens or closes one of the panel's inline forms (subForm, linkForm, prForm). */
export const showForm = (form: 'subForm' | 'linkForm' | 'prForm', open: boolean) => {
  S[form] = open;
  emit();
};

export type IssueProps = { t: Any; edit: boolean };
