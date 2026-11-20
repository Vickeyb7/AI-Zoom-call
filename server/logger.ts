/**
 * Structured backend logger honoring LOG_LEVEL (DEBUG | INFO | WARN | ERROR).
 * Never emits raw transcript text or API secrets.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export function validateLogLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || 'INFO').trim().toUpperCase();
  if (raw === 'DEBUG' || raw === 'INFO' || raw === 'WARN' || raw === 'ERROR') {
    return raw;
  }
  throw new Error(
    `Invalid LOG_LEVEL="${process.env.LOG_LEVEL}". Allowed values: DEBUG, INFO, WARN, ERROR.`,
  );
}

export function getLogLevel(): LogLevel {
  try {
    return validateLogLevel();
  } catch {
    return 'INFO';
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getLogLevel()];
}

function formatLine(level: LogLevel, scope: string, message: string): string {
  return `${new Date().toISOString()} [${level}] [${scope}] ${message}`;
}

export const logger = {
  debug(scope: string, message: string): void {
    if (shouldLog('DEBUG')) console.debug(formatLine('DEBUG', scope, message));
  },
  info(scope: string, message: string): void {
    if (shouldLog('INFO')) console.log(formatLine('INFO', scope, message));
  },
  warn(scope: string, message: string): void {
    if (shouldLog('WARN')) console.warn(formatLine('WARN', scope, message));
  },
  error(scope: string, message: string): void {
    if (shouldLog('ERROR')) console.error(formatLine('ERROR', scope, message));
  },
};
