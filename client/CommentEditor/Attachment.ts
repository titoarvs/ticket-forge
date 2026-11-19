'use client';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import type { Any } from '../core';

export type Attachment = { id: string; name: string; mime: string; bytes: number };
export type CommentValue = { doc: Any; text: string; attachments: Attachment[] };
// Links only to web and mail addresses; they open in a new tab.
const LINK = {
  openOnClick: false,
  autolink: true,
  defaultProtocol: 'https',
  protocols: ['http', 'https', 'mailto'],
  HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
};
export const extensions = (placeholder = '') => [
  StarterKit.configure({ heading: { levels: [3, 4] }, link: LINK as Any }),
  ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
];
export const MAX_DOC = 200_000;
