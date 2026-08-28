#!/usr/bin/env node
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';

dotenv.config({ override: false });

const backendDir = resolve(import.meta.dirname, '..');
const configured = process.env.DB_PATH || './data/app.db';
const source = isAbsolute(configured) ? configured : resolve(backendDir, configured);
const backupDir = process.env.KW_BACKUP_DIR || resolve(backendDir, '../backups');
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

console.log(JSON.stringify({ ok: true, source, destination, integrity: 'ok' }));
