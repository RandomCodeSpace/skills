import pino from 'pino';
import { config } from './config.js';

export const baseLogger = pino({ level: config.LOG_LEVEL });

export function childLogger(module: string): pino.Logger {
  return baseLogger.child({ module });
}
