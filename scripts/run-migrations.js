import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import pool from '../src/config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function run() {
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await ensureMigrationsTable(client);

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      const alreadyApplied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      );

      if (alreadyApplied.rowCount > 0) {
        console.log(`Skipping ${filename} (already applied)`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');

      await client.query('BEGIN');
      transactionOpen = true;
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
      await client.query('COMMIT');
      transactionOpen = false;

      console.log(`Applied ${filename}`);
    }

    console.log('Migrations finished successfully.');
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK');
    }
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
