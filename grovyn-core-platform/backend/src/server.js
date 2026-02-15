/**
 * Server entry. Boots seed, initializes services, then starts HTTP server.
 */

import app from './app.js';
import { config } from './config/index.js';
import { runBootstrap } from './bootstrap.js';
import * as orderIngestionService from './services/orderIngestionService.js';

function main() {
  try {
    runBootstrap();
  } catch (err) {
    console.error('Bootstrap failed:', err.message);
    process.exit(1);
  }

  const ingestionCounts = orderIngestionService.getIngestionCounts();
  console.log('Orders ingested:', ingestionCounts.total);

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
