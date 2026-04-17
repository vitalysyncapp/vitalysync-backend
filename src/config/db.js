// config/db.js
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_POOL_MAX_USES = 7500;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldUseSsl() {
  return process.env.DB_SSL !== 'false';
}

function createPool() {
  const connectionConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT || 5432,
      };

  return new pg.Pool({
    ...connectionConfig,
    ssl: shouldUseSsl()
      ? {
          rejectUnauthorized: false, // required for Render Postgres
        }
      : false,
    keepAlive: true,
    idleTimeoutMillis: toNumber(
      process.env.DB_IDLE_TIMEOUT_MS,
      DEFAULT_IDLE_TIMEOUT_MS
    ),
    connectionTimeoutMillis: toNumber(
      process.env.DB_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS
    ),
    max: toNumber(process.env.DB_POOL_MAX, DEFAULT_POOL_MAX),
    maxUses: toNumber(process.env.DB_POOL_MAX_USES, DEFAULT_POOL_MAX_USES),
  });
}

function isTransientConnectionError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  const code = String(error?.code ?? '').toUpperCase();

  return (
    message.includes('connection terminated unexpectedly') ||
    message.includes('terminating connection due to administrator command') ||
    message.includes('client has encountered a connection error') ||
    message.includes('connection ended unexpectedly') ||
    message.includes('server closed the connection unexpectedly') ||
    code === '57P01' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE'
  );
}

let pool = createPool();

function attachPoolErrorHandler(targetPool) {
  targetPool.on('error', (error) => {
    console.error('Unexpected idle PostgreSQL client error:', error);
  });
}

attachPoolErrorHandler(pool);

async function recreatePool() {
  const previousPool = pool;
  pool = createPool();
  attachPoolErrorHandler(pool);

  try {
    await previousPool.end();
  } catch (error) {
    console.error('Failed to close previous PostgreSQL pool cleanly:', error);
  }
}

async function withRetry(operation) {
  try {
    return await operation(pool);
  } catch (error) {
    if (!isTransientConnectionError(error)) {
      throw error;
    }

    console.error('Transient PostgreSQL connection issue detected, retrying once:', error);
    await recreatePool();
    return operation(pool);
  }
}

const db = {
  query(text, params) {
    return withRetry((activePool) => activePool.query(text, params));
  },

  connect() {
    return withRetry((activePool) => activePool.connect());
  },

  end() {
    return pool.end();
  },
};

export default db;
