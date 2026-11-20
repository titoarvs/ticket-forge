import path from 'node:path';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

export const SUPPORTED = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.csv',
  '.json',
  '.xlsx',
  '.rtf',
];

export const PDF_UNSUPPORTED =
  'PDF parsing is not yet supported. Paste the text, or save the file as .docx or .txt and upload that instead.';
const MAX_RETRIES = 2; // a failed parse is tried again up to this many times before the error is reported
const RETRY_DELAY_MS = 250;

/**
 * An error that retrying can't fix (unsupported format): `permanent` skips the retries, `code` lets
 * routes pick a status.
 */
function permanentError(message, code) {
  return Object.assign(new Error(message), { permanent: true, code });
}

/**
 * Reads the text of an uploaded file. A failed parse is retried (MAX_RETRIES times) and each
 * failure is logged with the file name, type, error message and retry count. PDFs are not parsed
 * yet (deferred), and pdf-parse is never loaded: it needs DOMMatrix, which Node serverless
 * functions don't have.
 */
export async function extractText(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  for (let retries = 0; ; retries++) {
    try {
      return await parseOnce(buffer, ext);
    } catch (e) {
      console.error(
        `[parse] failed: file="${filename}" type="${ext || 'unknown'}" error="${e?.message || e}" retries=${retries}`,
      );
      if (e?.permanent || retries >= MAX_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (retries + 1)));
    }
  }
}

async function parseOnce(buffer, ext) {
  switch (ext) {
    case '.pdf':
      throw permanentError(PDF_UNSUPPORTED, 'PDF_UNSUPPORTED');
    case '.docx': {
      const { value } = await (mammoth as any).convertToMarkdown({ buffer });
      return clean(value);
    }
    case '.html':
    case '.htm':
      return clean(
        buffer
          .toString('utf8')
          .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
          .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>'),
      );
    case '.xlsx': {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const out: any[] = [];
      wb.eachSheet((ws) => {
        out.push(`## Sheet: ${ws.name}`);
        ws.eachRow((row: any) =>
          out.push(
            row.values
              .slice(1)
              .map((v) => (v && typeof v === 'object' ? (v.text ?? v.result ?? '') : (v ?? '')))
              .join(' | '),
          ),
        );
      });
      return clean(out.join('\n'));
    }
    case '.rtf':
      return clean(
        buffer
          .toString('utf8')
          .replace(/\\par[d]?/g, '\n')
          .replace(/\{\*?\\[^{}]+}|[{}]|\\[a-z]+-?\d* ?/gi, ''),
      );
    case '.doc':
      throw permanentError(
        'Legacy .doc files are not supported. Save the file as .docx and try again.',
        'DOC_UNSUPPORTED',
      );
    default:
      return clean(buffer.toString('utf8'));
  }
}

function clean(t) {
  return String(t || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
