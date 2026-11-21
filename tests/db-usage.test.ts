// Which database the app uses and how full the Supabase free plan is (Administration → Email &
// database, `npm run db:switch -- status`). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, usageOf, mb, SUPABASE_FREE_BYTES } from '../lib/db-usage';

test('the kind of database comes from its address', () => {
  assert.equal(kindOf(''), 'builtin');
  assert.equal(
    kindOf('postgresql://postgres.x:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'),
    'supabase',
  );
  assert.equal(kindOf('postgresql://postgres:pw@db.abcd.supabase.co:5432/postgres'), 'supabase');
  assert.equal(kindOf('postgresql://me@localhost:5432/ticketforge'), 'local');
  assert.equal(kindOf('postgresql://me@127.0.0.1/ticketforge'), 'local');
  assert.equal(kindOf('postgresql://u:p@db.example.com/tf'), 'other');
  assert.equal(kindOf('postgresql://u:p@notsupabase.com/tf'), 'other');
});

test('the free plan share and the near-limit warning apply to Supabase only', () => {
  const half = usageOf('supabase', SUPABASE_FREE_BYTES / 2);
  assert.deepEqual([half.percent, half.nearLimit], [50, false]);
  const near = usageOf('supabase', SUPABASE_FREE_BYTES * 0.85);
  assert.deepEqual([near.percent, near.nearLimit], [85, true]);
  const local = usageOf('local', SUPABASE_FREE_BYTES * 2);
  assert.deepEqual([local.limitBytes, local.percent, local.nearLimit], [null, null, false]);
  assert.equal(usageOf('supabase', null).percent, null);
});

test('sizes read as megabytes', () => {
  assert.equal(mb(null), '—');
  assert.equal(mb(3 * 1024 * 1024), '3.0 MB');
  assert.equal(mb(30 * 1024 * 1024), '30 MB');
});
