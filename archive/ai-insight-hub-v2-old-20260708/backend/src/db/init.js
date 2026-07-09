import Database from 'node:sqlite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/app.db');

export function initDatabase() {
  const db = new Database(DB_PATH);
  
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  
  db.exec(schema);
  
  console.log('✅ Database initialized successfully');
  
  return db;
}

export function getDatabase() {
  return new Database(DB_PATH);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  initDatabase();
}
