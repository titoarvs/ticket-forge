// electron-builder afterSign hook (macOS). With an Apple "Developer ID" certificate the app is
// already signed properly and this does nothing. Without one, electron-builder leaves the bundle
// unsigned, which Apple Silicon Macs refuse to open ("is damaged"). Sign it ad hoc so people can open
// it with right-click → Open (or System Settings → Privacy & Security → Open Anyway).
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'ignore' });
    return; // properly signed already
  } catch {
    /* not signed: sign ad hoc below */
  }
  console.log(`  • ad-hoc signing  app=${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
