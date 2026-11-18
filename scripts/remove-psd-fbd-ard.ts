// TF-125: permanently deletes every PSD, FBD and ARD from the database in DATABASE_URL (or the built-in local one).
// It can't be undone: take a backup of that database first. Run it once per database, Test first, then production.
//
//   npm run db:remove-psd-fbd-ard               shows what would be deleted, and the kind values each table holds
//   npm run db:remove-psd-fbd-ard -- --confirm  deletes it all in one transaction and records the migration
//
// What is deleted, and what stays, is listed in lib/remove-psd-fbd-ard.ts.
import { tx, q, dbInfo, useOwner, db } from '../lib/db';
import { survey, removePsdFbdArd, MIGRATION_ID } from '../lib/remove-psd-fbd-ard';

const confirm = process.argv.includes('--confirm');
useOwner(true); // as the table owner: row-level security would hide other workspaces' rows

await db();
console.log(`Database: ${dbInfo.label}`);
const before = await survey(q);
if (before.done) {
  console.log(`${MIGRATION_ID} is already recorded in schema_migrations: nothing to do.`);
  process.exit(0);
}
console.log('kind values in the tables (only psd, fbd and ard are deleted):');
for (const [t, kinds] of Object.entries(before.kinds)) console.log(`  ${t}: ${kinds.length ? kinds.join(', ') : '(no rows)'}`);
console.log(confirm ? 'Deleting:' : 'Would delete:');
for (const [what, count] of Object.entries(before.counts)) console.log(`  ${what}: ${count}`);

if (!confirm) {
  console.log('\nNothing was changed. Take a backup of this database, then run it again with --confirm to delete permanently.');
  process.exit(0);
}

const result = await tx(({ query }: any) => removePsdFbdArd(query));
if (result.skipped) console.log(`${MIGRATION_ID} was recorded by another run in the meantime: nothing was changed.`);
else {
  console.log('Deleted:');
  for (const [what, count] of Object.entries(result.counts)) console.log(`  ${what}: ${count}`);
  console.log(`Recorded ${MIGRATION_ID} in schema_migrations.`);
}
process.exit(0);
