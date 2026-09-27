import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadConfig } from './config.js';
const file = resolve('sql/001_create_otp_emails.sql');
const pool = new pg.Pool({connectionString:loadConfig().DATABASE_URL});
try { await pool.query(await readFile(file,'utf8')); console.log('Schema ready'); }
finally { await pool.end(); }
