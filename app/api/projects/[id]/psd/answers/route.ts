import { docAnswersPost } from '@/lib/server/doc-answers-route';

// Updating a document with the answers takes a minute or two.
export const maxDuration = 300;

export const POST = docAnswersPost('psd');
