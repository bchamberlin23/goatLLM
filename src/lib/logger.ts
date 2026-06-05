/**
 * Structured logger.
 *
 * Thin facade over `console.*` that gives every log call a stable shape:
 *   { ts, level, tag, msg, data }
 *
 * Today the implementation is console-backed (so existing DevTools and
 * Tauri's webview console keep working unchanged). The intent is that the
 * sink can be swapped in one place — e.g. to forward to a Tauri command
 * for a persistent log file, or to a remote collector — without touching
 * the ~30 call sites that already log through `log.*`.
 *
 * Conventions:
 *   - `log.error` is the only level that wraps an Error into `data.error`.
 *     Pass the raw Error as the third argument; the helper stringifies
 *     non-Error values defensively so call sites can stay terse.
 *   - `tag` is a short, stable string identifying the subsystem
 *     ("db", "agentLoop", "deep-research", "memory", …). It's appended to
 *     the message line for grep-ability — keep it free of brackets and
 *     colons so the prefix stays parseable.
 *   - `data` is anything you want to attach. The logger does not clone or
 *     sanitize it; avoid passing DOM nodes, React refs, or anything with a
 *     throwing toJSON.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  /** Short subsystem tag. Appended to the line as `[tag]`. */
  tag?: string;
  /** Structured payload. Printed after the message. */
  data?: unknown;
}

export interface LogRecord {
  ts: number;
  level: LogLevel;
  tag: string | null;
  msg: string;
  data: unknown;
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  const record: LogRecord = {
    ts: Date.now(),
    level,
    tag: fields?.tag ?? null,
    msg,
    data: fields?.data,
  };

  const line = formatLine(record);

  switch (level) {
    case "debug":
      console.debug(line, record.data);
      break;
    case "info":
      console.info(line, record.data);
      break;
    case "warn":
      console.warn(line, record.data);
      break;
    case "error":
      console.error(line, record.data);
      break;
  }
}

function formatLine(record: LogRecord): string {
  if (record.tag) return `[${record.tag}] ${record.msg}`;
  return record.msg;
}

function normalizeError(err: unknown): { error: string } {
  if (err instanceof Error) return { error: err.message };
  return { error: String(err) };
}

export const log = {
  debug(msg: string, fields?: LogFields): void {
    emit("debug", msg, fields);
  },
  info(msg: string, fields?: LogFields): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: LogFields): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: LogFields): void {
    emit("error", msg, fields);
  },
};

/**
 * Convenience wrapper for the common `catch (err) { log.warn("…", { tag, data: { error: err } }) }`
 * pattern. Coerces the error to `{ error: string }` and merges it into `data`.
 *
 *   } catch (err) {
 *     log.warn("thing failed", withError("db", { foo: 1 }, err));
 *   }
 */
export function withError(
  tag: string,
  data: Record<string, unknown> | undefined,
  err: unknown,
): LogFields {
  const safeData: Record<string, unknown> = data ?? {};
  return {
    tag,
    data: { ...safeData, ...normalizeError(err) },
  };
}

export { normalizeError };
