/**
 * Runs `fn` while holding an in-process lock for `key`: calls with the same key run one at a time,
 * in arrival order; different keys run concurrently.
 *
 * It exists for "read a count, then insert" rules (a per-upload segment cap, "points only for the
 * first scene submission") where two concurrent requests would otherwise both read the old count.
 * The obvious database alternative -- SELECT ... FOR UPDATE or an advisory lock -- makes every
 * waiting request hold a pooled connection while it waits, and this app has already been taken
 * down once by exactly that (the connection pool wedging); waiting here costs no connection.
 *
 * Scope: one Node process. The backend runs as a single Railway instance; if it is ever scaled to
 * several, the window for a race between instances is only the few milliseconds of one
 * transaction, and the worst case is one extra segment or one extra award, not corruption.
 */
const tails = new Map<string, Promise<void>>();

export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => mine);
  tails.set(key, tail);

  // `previous` only ever settles via some caller's `release()`, never by rejecting.
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
