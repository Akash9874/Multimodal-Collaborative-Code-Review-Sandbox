/**
 * Apply the SQL migrations to whatever DATABASE_URL points at — a local Postgres (`pnpm db:up`)
 * or a Supabase project. The same script serves both; the connection string is the only thing
 * that moves.
 *
 * This is a Node script rather than the obvious `psql -f` one-liner because psql is a separate
 * install that most contributors do not have, and because `psql "$DATABASE_URL"` does not expand
 * on Windows, where package scripts run through cmd.exe. `pg` is already a dependency of this
 * package, so there is nothing new to install.
 *
 * The connection string is passed through untouched, exactly as PostgresRoomStore passes it to its
 * Pool. That is deliberate: if a URL needs `?sslmode=require` to reach Supabase, it needs it in
 * both places, and applying the migration proves the server can connect the same way.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [join(HERE, '..', 'sql', '001_persistence.sql')];

/** Matches docker/postgres/compose.yml. `pnpm db:up` passes --local so it need not set an env var. */
const LOCAL_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
const local = process.argv.includes('--local');

const url = local ? LOCAL_URL : process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL is not set. Nothing to migrate.\n');
  console.error('  Local:    pnpm db:up   (boots Postgres and applies this for you)');
  console.error('  Supabase: set DATABASE_URL to the Session pooler connection string, then rerun.');
  process.exit(1);
}

// Never print the password. The host is enough to tell "local" from "I am about to alter prod".
const display = (() => {
  try {
    const { hostname, port, pathname } = new URL(url);
    return `${hostname}:${port || 5432}${pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
})();

console.log(`applying migrations to ${display}`);

const client = new Client({ connectionString: url });

try {
  await client.connect();
} catch (error) {
  console.error(`\ncannot connect to ${display}: ${error.message}\n`);
  console.error('  Local:    is it up? `pnpm db:up`, or `pnpm db:logs` to look.');
  console.error('  Supabase: check the password, and that the URL is the Session pooler one');
  console.error('            (port 5432). Some networks need `?sslmode=require` appended.');
  process.exit(1);
}

try {
  for (const path of MIGRATIONS) {
    const sql = await readFile(path, 'utf8');
    // Each file is one transaction: a half-applied schema is worse than none.
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log(`✓ ${path.split(/[\\/]/).pop()}`);
  }

  // Prove the schema is actually there, rather than trusting that the statements returned without
  // error — `create table if not exists` succeeds just as quietly when it does nothing.
  const { rows } = await client.query(
    `select column_name, data_type from information_schema.columns
     where table_schema = 'sandbox' and table_name = 'rooms'
     order by ordinal_position`,
  );

  if (rows.length === 0) {
    console.error('\n✗ migration ran but sandbox.rooms does not exist. Nothing was applied.');
    process.exit(1);
  }

  console.log('\nsandbox.rooms:');
  for (const { column_name, data_type } of rows) console.log(`  ${column_name} — ${data_type}`);

  console.log('\nthe database is ready. The server and the tests read DATABASE_URL:');
  if (local) {
    console.log(`  bash        export DATABASE_URL='${LOCAL_URL}'`);
    console.log(`  PowerShell  $env:DATABASE_URL='${LOCAL_URL}'`);
  } else {
    console.log(`  already set to ${display}`);
  }
} catch (error) {
  await client.query('rollback').catch(() => {});
  console.error(`\n✗ migration failed: ${error.message}`);
  process.exit(1);
} finally {
  await client.end();
}
