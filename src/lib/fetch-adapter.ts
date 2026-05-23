let _fetch: typeof fetch | null = null;
let _initPromise: Promise<typeof fetch> | null = null;

export function initFetch(): Promise<typeof fetch> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const mod = await import("@tauri-apps/plugin-http");
      _fetch = mod.fetch;
      return _fetch;
    } catch (err) {
      const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
      if (inTauri) {
        console.error(
          "[fetch-adapter] Failed to load @tauri-apps/plugin-http inside Tauri. " +
            "Cross-origin requests will hit CORS. " +
            "If you see a 504 from Vite for this module, restart with `pnpm dev --force` to rebuild the optimize-deps cache.",
          err,
        );
      }
      _fetch = globalThis.fetch.bind(globalThis);
      return _fetch;
    }
  })();

  return _initPromise;
}

export function getFetch(): typeof fetch | null {
  return _fetch;
}
