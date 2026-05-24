/**
 * Date/time formatting helpers for chat surfaces. All output is locale-aware
 * via Intl, so the user sees their system's preferred clock format (12h vs
 * 24h, day-of-week conventions) without us hardcoding a style.
 *
 * Two formats matter:
 *   - inline message time: short, e.g. "2:34 PM" — sits next to the role label
 *   - date separator label: "Today", "Yesterday", "Mon, May 24", or
 *     "May 24, 2025" once the year stops matching the current one.
 */

const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** True if both timestamps fall on the same calendar day in local time. */
export function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** Short clock time: "2:34 PM" / "14:34". */
export function formatMessageTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Date separator label, picked relative to today:
 *   - same day      → "Today"
 *   - 1 day prior   → "Yesterday"
 *   - same year     → "Mon, May 24"
 *   - older         → "May 24, 2025"
 */
export function formatDateSeparator(ts: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  const diffDays = Math.round((today - day) / DAY_MS);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
  if (sameYear) {
    return new Date(ts).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Long, accessible label for screen readers and tooltips. */
export function formatLongDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
