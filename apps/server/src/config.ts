import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '../../..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.argv.includes('--production');
const port = Number(process.env.PORT || 8787);
const dataDir = path.resolve(ROOT_DIR, process.env.ASTRA_DATA_DIR || 'data');

export const config = {
  rootDir: ROOT_DIR,
  dataDir,
  dbPath: path.join(dataDir, 'astra.db'),
  webDist: path.join(ROOT_DIR, 'apps/web/dist'),
  port,
  isProduction,
  jwtSecret:
    process.env.JWT_SECRET ||
    'astra-local-development-secret-change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  appSecret:
    process.env.APP_SECRET ||
    'astra-local-encryption-secret-change-me-in-production',
  vectorDatabaseUrl: process.env.VECTOR_DATABASE_URL || '',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  version: '1.1.0',
};

if (isProduction && !process.env.JWT_SECRET) {
  console.warn(
    '[astra] WARNING: JWT_SECRET is not set. Configure it before exposing the service.',
  );
}
