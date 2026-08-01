/**
 * Server entry. Starts the HTTP server.
 *
 * Integration Task 3, round 3: previously ran `runBootstrap()` first --
 * seeding an entire in-memory legacy demo dataset and initializing ~19
 * legacy services on every boot, none of which any live route has served
 * since Integration Task 2 (round 3) unmounted their last consumers.
 * Removed along with `bootstrap.js`/`seed/`/the legacy service+engine tree
 * itself -- see this task's report for the full deletion list.
 *
 * Pre-existing local-dev gap, found and fixed here: `backend/.env.example`
 * has always said "copy to `.env`", but nothing in this runtime entrypoint
 * ever loaded a `.env` file -- only `drizzle.config.js`'s CLI did (via its
 * own `import 'dotenv/config'`). A correctly-filled-in `.env` was silently
 * inert for `node src/server.js`; only real shell-exported env vars ever
 * reached `process.env`, so `DATABASE_APP_URL is not set` fired even with a
 * populated `.env` sitting right next to it. `dotenv/config` must be the
 * FIRST import here (before `./app.js`, which transitively imports
 * `db/pool.js` -- that file reads `process.env.DATABASE_APP_URL` at module
 * load time and throws immediately if unset) so `.env` is loaded before
 * anything else evaluates. Safe in Docker too: dotenv never overrides a
 * variable `process.env` already has, and no `.env` file exists in the
 * container image at all -- compose's `environment:` block is the only
 * source there, unaffected by this.
 */

import 'dotenv/config';
import app from './app.js';
import { config } from './config/index.js';

function main() {
  const PREFERRED_FALLBACK_PORT = 3001;

  function startListening(port) {
    const server = app.listen(port, () => {
      console.log(`Core Data Service listening on port ${port}`);
      console.log(`Health: http://localhost:${port}/api/v1/health`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        if (port !== PREFERRED_FALLBACK_PORT) {
          console.warn(`Port ${port} is already in use. Trying ${PREFERRED_FALLBACK_PORT} (frontend proxy expects this)...`);
          startListening(PREFERRED_FALLBACK_PORT);
          return;
        }
        console.error(`Port ${port} is already in use. Either:`);
        console.error(`  1. Stop the other process: netstat -ano | findstr :${port}`);
        console.error(`  2. Then run again, or set PORT to another value and update frontend vite proxy.`);
      } else {
        console.error('Server error:', err);
      }
      process.exit(1);
    });

    function shutdown(signal) {
      console.log(`${signal} received, closing server...`);
      server.close((err) => {
        if (err) {
          console.error('Error closing server:', err);
          process.exit(1);
        }
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 5000);
    }

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  startListening(config.port);
}

main();
