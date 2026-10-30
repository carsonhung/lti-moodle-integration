/**
 * Shared LTI logger.
 *
 * A single injectable logger used by the 1.3 core, the normalized launch
 * handler, and the legacy 1.0a/1.1 router so `setLtiLogger` affects every part
 * of the package. Structured metadata is flattened into a single string before
 * forwarding, so any logger that accepts plain strings works.
 */

export type Logger = {
  info: (...a: any[]) => void;
  warn: (...a: any[]) => void;
  error: (...a: any[]) => void;
};

let logger: Logger = { info: console.log, warn: console.warn, error: console.error };

/**
 * Inject a project-specific logger before calling initLti. The core wraps
 * structured metadata into a single string before forwarding so any logger
 * that accepts plain strings will work.
 */
export function setLtiLogger(custom: Logger): void {
  logger = custom;
}

function formatLogMeta(msg: string, meta?: any): string {
  if (!meta || (typeof meta === 'object' && Object.keys(meta).length === 0)) {
    return msg;
  }
  try {
    return `${msg} ${JSON.stringify(meta)}`;
  } catch {
    return `${msg} {"meta":"[unserializable]"}`;
  }
}

export function logInfo(msg: string, meta?: any): void {
  logger.info(formatLogMeta(msg, meta));
}
export function logWarn(msg: string, meta?: any): void {
  logger.warn(formatLogMeta(msg, meta));
}
export function logError(msg: string, meta?: any): void {
  logger.error(formatLogMeta(msg, meta));
}
