// Runs ONE generated Playwright script in its own process (regular servers).
// Input (stdin, JSON): see run-one.mjs. Output (stdout, last line JSON): { status, error, durationMs, screenshot, logs }
import { runOne } from './run-one.mjs';

const readStdin = async () => {
  let s = '';
  for await (const c of process.stdin) s += c;
  return s;
};
const result = await runOne(JSON.parse(await readStdin()));
process.stdout.write(`\n${JSON.stringify(result)}\n`);
process.exit(0);
