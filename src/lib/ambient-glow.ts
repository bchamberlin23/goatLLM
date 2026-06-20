import { useEffect, type RefObject } from "react";

function toPercentage(position: number, start: number, size: number) {
  if (size <= 0) return 0;
  return Math.min(100, Math.max(0, ((position - start) / size) * 100));
}

/**
 * Updates the ambient field without a React render so glow motion remains
 * responsive while the pointer moves across any part of the app window.
 */
export function useAmbientGlowPosition(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const updatePosition = (event: PointerEvent) => {
      const element = ref.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const x = toPercentage(event.clientX, rect.left, rect.width);
      const y = toPercentage(event.clientY, rect.top, rect.height);

      element.style.setProperty("--glow-x", `${String(x)}%`);
      element.style.setProperty("--glow-y", `${String(y)}%`);
    };

    window.addEventListener("pointermove", updatePosition, { passive: true });
    return () => {
      window.removeEventListener("pointermove", updatePosition);
    };
  }, [enabled, ref]);
}
