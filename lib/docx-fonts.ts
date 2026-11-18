// Shared by the server and the browser (the browser trims a template before uploading it).
/**
 * Drops embedded fonts the template doesn't use as such (bold and bold-italic files: the template's "bold" is
 * usually a Medium font), which keeps it under serverless upload and download limits. Works on a JSZip instance.
 */
export async function trimEmbeddedFonts(zip) {
  const ft = zip.file('word/fontTable.xml');
  const relsFile = zip.file('word/_rels/fontTable.xml.rels');
  if (!ft || !relsFile) return 0;
  let xml = await ft.async('string');
  let rels = await relsFile.async('string');
  const ids = [...xml.matchAll(/<w:embed(?:Bold|BoldItalic)\b[^>]*r:id="([^"]+)"[^>]*\/>/g)].map((m) => m[1]);
  let removed = 0;
  for (const id of ids) {
    const rel = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${id}"[^>]*/>`));
    const target = rel && (rel[0].match(/Target="([^"]+)"/) || [])[1];
    const stillUsed =
      target &&
      [...xml.matchAll(/<w:embed(?:Regular|Italic)\b[^>]*r:id="([^"]+)"/g)].some((m) =>
        rels.match(new RegExp(`Id="${m[1]}"[^>]*Target="${target}"|Target="${target}"[^>]*Id="${m[1]}"`)),
      );
    if (rel) rels = rels.replace(rel[0], '');
    if (target && !stillUsed) {
      zip.remove(`word/${target.replace(/^\.?\//, '')}`);
      removed++;
    }
  }
  xml = xml.replace(/<w:embed(?:Bold|BoldItalic)\b[^>]*\/>/g, '');
  zip.file('word/fontTable.xml', xml);
  zip.file('word/_rels/fontTable.xml.rels', rels);
  return removed;
}
