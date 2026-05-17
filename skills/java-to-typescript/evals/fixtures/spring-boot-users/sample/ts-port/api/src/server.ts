import { buildApp } from './app.js';
import { config } from './config.js';
import { baseLogger } from './logger.js';

const app = buildApp();
const server = app.listen(config.PORT, () => {
  baseLogger.info({ port: config.PORT }, 'server listening');
});

function shutdown(signal: string): void {
  baseLogger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
