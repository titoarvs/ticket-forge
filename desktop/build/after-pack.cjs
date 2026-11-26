// electron-builder afterPack hook. node-pty's prebuilt `spawn-helper` (macOS) is published without
// the execute permission, and the terminal can't start a shell without it ("posix_spawnp failed").
// Fix it in the packaged app, before it is signed.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'spawn-helper') out.push(p);
  }
  return out;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = `${context.packager.appInfo.productFilename}.app`;
  const pty = path.join(context.appOutDir, app, 'Contents', 'Resources', 'app', 'node_modules', 'node-pty');
  if (!fs.existsSync(pty)) return;
  for (const f of walk(pty)) fs.chmodSync(f, 0o755);
};
