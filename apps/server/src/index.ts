import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, initDb } from './db/index.js';
import { initVectorStore, closeVectorStore } from './vector/index.js';
import { stopIndexWorker } from './lib/indexer.js';

initDb();
const app = createApp();
void initVectorStore()
  .then((store) => {
    console.log(`  ▸ vector store: ${store.kind}`);
  })
  .catch((error) => {
    console.error('[astra] vector store unavailable', error);
  });

const server = app.listen(config.port, () => {
  const mode = config.isProduction ? 'production' : 'development';
  console.log(`\n  ▸ ASTRA API ready (${mode})`);
  console.log(`  ▸ http://localhost:${config.port}`);
  console.log(`  ▸ data: ${config.dbPath}`);
  console.log('  ▸ demo login: admin@astra.local / Astra@2026\n');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[astra] ${signal} received, shutting down...`);
  server.close();
  try {
    await stopIndexWorker();
    await closeVectorStore();
  } catch (error) {
    console.error('[astra] shutdown warning', error);
  }
  closeDb();
  setTimeout(() => process.exit(1), 5_000).unref();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

