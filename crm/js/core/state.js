// State belongs to one new feature host; legacy admin.html state remains untouched.
export function createState(initial = {}) {
  if (!initial || typeof initial !== 'object' || Array.isArray(initial)) {
    throw new TypeError('Initial state must be an object');
  }
  let current = Object.freeze({ ...initial });
  const listeners = new Set();
  return Object.freeze({
    get() { return current; },
    update(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new TypeError('State patch must be an object');
      }
      current = Object.freeze({ ...current, ...patch });
      for (const listener of listeners) listener(current);
      return current;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}
