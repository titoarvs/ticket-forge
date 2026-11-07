import path from 'node:path';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { PDFParse } from 'pdf-parse';

export const SUPPORTED = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.html', '.htm', '.csv', '.json', '.xlsx', '.rtf'];

export async function extractText(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  switch (ext) {
    case '.pdf': {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try { return clean((await parser.getText()).text); } finally { await parser.destroy(); }
    }
    case '.docx': {
      const { value } = await mammoth.convertToMarkdown({ buffer });
      return clean(value);
    }
    case '.html':
    case '.htm':
      return clean(buffer.toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    case '.xlsx': {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const out = [];
      wb.eachSheet((ws) => {
        out.push(`## Sheet: ${ws.name}`);
        ws.eachRow((row) => out.push(row.values.slice(1).map((v) => (v && typeof v === 'object' ? v.text ?? v.result ?? '' : v ?? '')).join(' | ')));
      });
      return clean(out.join('\n'));
    }
    case '.rtf':
      return clean(buffer.toString('utf8').replace(/\\par[d]?/g, '\n').replace(/\{\*?\\[^{}]+}|[{}]|\\[a-z]+-?\d* ?/gi, ''));
    case '.doc':
      throw new Error('Legacy .doc files are not supported. Save the file as .docx or PDF and try again.');
    default:
      return clean(buffer.toString('utf8'));
  }
}

function clean(t) {
  return String(t || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
