import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function migrateToV2() {
  const db = new DatabaseSync(DB_PATH);

  console.log('🔄 Migrating database to v0.2.0...');

  const schemaV2 = readFileSync(join(__dirname, 'schema-v2.sql'), 'utf-8');

  try {
    db.exec(schemaV2);
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrateToV2();
}
