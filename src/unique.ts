export class UniqueRetryLimitExceededError extends Error {
  constructor(maxRetries: number) {
    super(
      `Could not produce a new unique value after ${maxRetries} attempt(s) -- either the underlying value space is smaller than the number of unique values being requested, or maxRetries is set too low for how many collisions are actually expected.`
    );
    this.name = "UniqueRetryLimitExceededError";
  }
}

export interface UniqueTrackerOptions {
  /** How many times to retry a colliding value before giving up. Default 1000 -- generous for the realistic collision rates this is actually used against (a handful of retries per run at most), while still failing loudly rather than hanging if a value space turns out to be genuinely too small for what's being asked of it. */
  maxRetries?: number;
}

export interface UniqueTracker<T> {
  /** Calls `fn` until it returns a value this tracker hasn't seen before, then remembers it. Throws UniqueRetryLimitExceededError after `maxRetries` colliding attempts rather than looping forever. */
  next(fn: () => T): T;
  has(value: T): boolean;
  readonly size: number;
}

/**
 * The same guarantee faker-js's `faker.helpers.unique(...)` and faker-ruby's
 * `Faker::X.unique.method` provide -- eco-faker doesn't get this for free
 * just because its generation calls into @faker-js/faker under the hood,
 * since that library's own `.unique` tracks a *global, implicit* registry
 * on its shared instance, not one scoped to a single field within a single
 * generate() call the way this project actually needs it (one user's
 * email colliding with another user's *within the same dataset* is a real
 * bug; a *different* generate() call, or a differently-seeded one, should
 * start with a clean slate, which a hidden global registry doesn't
 * guarantee on its own without careful, easy-to-forget resets).
 *
 * `createUniqueTracker()` is explicit and scoped by construction instead:
 * the caller creates one, holds onto it for exactly as long as the
 * uniqueness constraint should apply, and it's garbage the moment that
 * scope ends -- there's no shared state to accidentally leak between two
 * unrelated generate() calls in the same process (a real risk for
 * anything long-running: the MCP server, the interactive playground, the
 * temporal scenario engine's multiple merged generate() calls).
 *
 * Deliberately does not touch eco-faker's own seeded Rng or faker-js's own
 * seeded PRNG -- a retry just calls `fn` again, consuming whatever random
 * state `fn` itself consumes. A real collision does shift every
 * subsequent faker-js draw in the same generate() call by however many
 * retries happened -- an intentional, determinism-preserving trade-off
 * (the same seed always collides, and always retries, the same number of
 * times, so output is still fully reproducible) rather than a compromise
 * of it, and the exact same trade-off faker-js's own `.unique()` makes
 * against its own shared PRNG.
 */
export function createUniqueTracker<T>(options: UniqueTrackerOptions = {}): UniqueTracker<T> {
  const maxRetries = options.maxRetries ?? 1000;
  const seen = new Set<T>();

  return {
    next(fn: () => T): T {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const value = fn();
        if (!seen.has(value)) {
          seen.add(value);
          return value;
        }
      }
      throw new UniqueRetryLimitExceededError(maxRetries);
    },
    has(value: T): boolean {
      return seen.has(value);
    },
    get size(): number {
      return seen.size;
    },
  };
}
