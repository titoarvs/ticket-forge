// The page shown while the server starts.
'use strict';

const { APP_NAME } = require('./paths.cjs');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #f6f6f7; color: #333; }
  @media (prefers-color-scheme: dark) { body { background: #161616; color: #ddd; } }
  .box { text-align: center; }
  .logo { width: 56px; height: 56px; border-radius: 13px; background: #161616; display: grid; place-items: center; margin: 0 auto 16px; }
  @media (prefers-color-scheme: dark) { .logo { background: #2b2b2b; } }
  .bar { width: 160px; height: 3px; border-radius: 3px; background: rgba(127,127,127,.25); overflow: hidden; margin: 14px auto 0; }
  .bar::after { content: ""; display: block; width: 40%; height: 100%; background: currentColor; opacity: .6;
                animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
  @media (prefers-reduced-motion: reduce) { .bar::after { animation: none; width: 100%; } }
</style></head><body><div class="box">
  <div class="logo"><svg width="30" height="30" viewBox="0 0 32 32"><path d="M8 9h16v4h-6v11h-4V13H8z" fill="#fff"/></svg></div>
  <div>Starting ${APP_NAME}…</div><div class="bar"></div>
</div></body></html>`;

module.exports = { loadingPage: () => 'data:text/html;charset=utf-8,' + encodeURIComponent(HTML) };
