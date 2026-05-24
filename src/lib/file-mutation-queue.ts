/**
 * Serialize file-mutation operations targeting the same absolute path.
 * Operations against different paths still run concurrently.
 *
 * Ported from pi-coding-agent's `core/tools/file-mutation-queue.ts`. Without
 * this, two `edit_file` calls firing in parallel against the same path can
 * race: both read the original, both apply their own diff, the second write
 * silently clobbers the first.
 */
const queues = new Map<string, Promise<unknown>>();

export async function withFileMutationQueue<T>(absolutePath: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(absolutePath) ?? Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(absolutePath, previous.then(() => next));
  try {
    await previous;
    return await fn();
  } finally {
    release();
    // Clean up if we're the tail of the chain so the map doesn't grow forever.
    if (queues.get(absolutePath) === previous.then(() => next)) {
      queues.delete(absolutePath);
    }
  }
}
