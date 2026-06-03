/** Persisted expand/collapse preference for reasoning blocks. */

const GLOBAL_KEY = "goatllm-thinking-pref";
const TRACE_GLOBAL_KEY = "goatllm-trace-pref";
const MSG_PREFIX = "goatllm-thinking-msg:";
const TRACE_MSG_PREFIX = "goatllm-trace-msg:";

export type ThinkingPref = "expanded" | "collapsed";

function readGlobal(): ThinkingPref | null {
  try {
    const v = localStorage.getItem(GLOBAL_KEY);
    return v === "expanded" || v === "collapsed" ? v : null;
  } catch {
    return null;
  }
}

function readMessage(messageId: string): ThinkingPref | null {
  try {
    const v = localStorage.getItem(MSG_PREFIX + messageId);
    return v === "expanded" || v === "collapsed" ? v : null;
  } catch {
    return null;
  }
}

/** Whether the thinking trace should render expanded for this message. */
export function shouldExpandThinking(messageId: string, running: boolean): boolean {
  const perMsg = readMessage(messageId);
  if (perMsg === "collapsed") return false;
  if (perMsg === "expanded") return true;
  const global = readGlobal();
  if (global === "collapsed") return false;
  if (global === "expanded") return true;
  // Default: stream open while reasoning; collapsed once the answer starts.
  return running;
}

export function setThinkingPref(messageId: string, expanded: boolean): void {
  const pref: ThinkingPref = expanded ? "expanded" : "collapsed";
  try {
    localStorage.setItem(MSG_PREFIX + messageId, pref);
    localStorage.setItem(GLOBAL_KEY, pref);
  } catch {
    /* ignore quota */
  }
}

function readTraceMessage(messageId: string): ThinkingPref | null {
  try {
    const v = localStorage.getItem(TRACE_MSG_PREFIX + messageId);
    return v === "expanded" || v === "collapsed" ? v : null;
  } catch {
    return null;
  }
}

/** Agent tool-trace timeline expand state (separate from reasoning blocks). */
export function shouldExpandTrace(messageId: string, running: boolean): boolean {
  const perMsg = readTraceMessage(messageId);
  if (perMsg === "collapsed") return false;
  if (perMsg === "expanded") return true;
  try {
    const global = localStorage.getItem(TRACE_GLOBAL_KEY);
    if (global === "collapsed") return false;
    if (global === "expanded") return true;
  } catch {
    /* ignore */
  }
  return running;
}

export function setTracePref(messageId: string, expanded: boolean): void {
  const pref: ThinkingPref = expanded ? "expanded" : "collapsed";
  try {
    localStorage.setItem(TRACE_MSG_PREFIX + messageId, pref);
    localStorage.setItem(TRACE_GLOBAL_KEY, pref);
  } catch {
    /* ignore quota */
  }
}
