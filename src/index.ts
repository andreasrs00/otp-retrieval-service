import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createApp } from './app.js';
const config=loadConfig();
const db=createDb(config.DATABASE_URL);
const server=createApp(config,db).listen(config.PORT,() => console.log(`Listening on ${config.PORT}`));
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,() => server.close(() => { void db.close().finally(() => process.exit(0)); }));
