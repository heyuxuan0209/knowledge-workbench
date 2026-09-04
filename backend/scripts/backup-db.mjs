#!/usr/bin/env node
import { mkdirSync, chmodSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';

dotenv.config({ override: false });

const backendDir = resolve(import.meta.dirname, '..');
const configured = process.env.DB_PATH || './data/app.db';
const source = isAbsolute(configured) ? configured : resolve(backendDir, configured);
const backupDir = process.env.KW_BACKUP_DIR || resolve(backendDir, '../backups');
const retain = Number.parseInt(process.env.KW_BACKUP_RETAIN || '30', 10);
if (!Number.isInteger(retain) || retain < 1) {
  throw new Error(`KW_BACKUP_RETAIN must be a positive integer, got: ${process.env.KW_BACKUP_RETAIN}`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = join(backupDir, `app-${stamp}.db`);
const sqlDestination = `'${destination.replaceAll("'", "''")}'`;

mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });

const src = new DatabaseSync(source, { readOnly: true });
src.exec(`VACUUM INTO ${sqlDestination}`);
src.close();
chmodSync(destination, 0o600);

const copy = new DatabaseSync(destination, { readOnly: true });
const result = copy.prepare('PRAGMA integrity_check').get();
copy.close();
if (result.integrity_check !== 'ok') throw new Error(`backup integrity_check failed: ${result.integrity_check}`);

// 只清理由本脚本生成的时间戳备份；迁移手工备份在其它目录，不受影响。
const backups = readdirSync(backupDir)
  .filter((name) => /^app-\d{4}-\d{2}-\d{2}T.*\.db$/.test(name))
  .sort();
const expired = backups.slice(0, Math.max(0, backups.length - retain));
for (const name of expired) unlinkSync(join(backupDir, name));

console.log(JSON.stringify({
  ok: true,
  source,
  destination,
  integrity: 'ok',
  retained: backups.length - expired.length,
  pruned: expired.length,
}));
