'use client';

// Rich-text comments (TipTap), like Jira: bold, italic, strike, code, lists, quotes, code blocks
// and links, with Markdown-style shortcuts, plus file attachments (button, drag and drop, or
// paste). Saved comments keep the TipTap document for display, a plain-text copy for search and
// exports, and their attachments.

export type { Attachment, CommentValue } from './CommentEditor/Attachment';
export { textToDoc, CommentEditor } from './CommentEditor/CommentEditor';
export { docToText, RichTextField, CommentBody, Attachments } from './CommentEditor/Attachments';
export type { RichValue } from './CommentEditor/Attachments';
