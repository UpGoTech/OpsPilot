type Handler<T> = (event: { payload: T }) => void;

const buses = new Map<string, Set<Handler<unknown>>>();

function bus(name: string): Set<Handler<unknown>> {
  let set = buses.get(name);
  if (!set) {
    set = new Set();
    buses.set(name, set);
  }
  return set;
}

/** Chrome stand-in for `@tauri-apps/api/event` `listen`. */
export async function listen<T>(
  event: string,
  handler: Handler<T>,
): Promise<() => void> {
  const set = bus(event);
  const wrapped = handler as Handler<unknown>;
  set.add(wrapped);
  return () => {
    set.delete(wrapped);
  };
}

export type UnlistenFn = () => void;

/** Used by the native gateway to push state/events into Pinia listeners. */
export function emit<T>(event: string, payload: T): void {
  for (const handler of bus(event)) {
    try {
      handler({ payload });
    } catch {
      // Listener errors must not break the gateway loop.
    }
  }
}
