import { useState, useEffect, useRef } from 'react';

/**
 * Returns throttled display content during LLM streaming. Every token is
 * accumulated in a ref (never lost), but React state updates fire at fixed
 * intervals via setInterval. When streaming ends, the final content flushes
 * immediately.
 */
export function useThrottledContent(
  rawContent: string,
  isStreaming: boolean,
  throttleMs = 32,
): string {
  const [display, setDisplay] = useState(rawContent);
  const latestRef = useRef(rawContent);
  const timerRef = useRef<number | null>(null);

  // Always keep ref in sync — no tokens lost regardless of display rate.
  latestRef.current = rawContent;

  // The effect only depends on isStreaming, not rawContent. A setInterval
  // fires at a fixed cadence during streaming and reads latestRef.current
  // when it ticks, so every token lands in the display eventually.
  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setDisplay(latestRef.current);
      return;
    }

    // Flush immediately on stream start.
    setDisplay(latestRef.current);

    if (timerRef.current != null) clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setDisplay(latestRef.current);
    }, throttleMs);

    return () => {
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isStreaming, throttleMs]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current != null) clearInterval(timerRef.current);
    };
  }, []);

  return display;
}
