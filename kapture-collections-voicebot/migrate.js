// A minimal, dependency-free migration runner: applies any .sql file in
// migrations/ that hasn't been applied yet, tracked in a schema_migrations
// table. No ORM binary download required — just the `pg` driver.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (rows.length > 0) {
      console.log(`[migrate] skip (already applied): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`[migrate] applying: ${file}`);
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(`[migrate] applied: ${file}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error(`[migrate] FAILED: ${file}`, err.message);
      process.exit(1);
    }
  }

  await pool.end();
  console.log('[migrate] done.');
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
