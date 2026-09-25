import { createFeatureFlags } from './feature-flags.js';

// This registry has no hashchange listener. A future, reviewed host integration
// may consult resolve() before the legacy router's fallback branch.
export function createRouterExtension({ flags = createFeatureFlags() } = {}) {
  if (!flags || typeof flags.isEnabled !== 'function') throw new TypeError('Feature flags are required');
  const routes = new Map();
  const resolve = hash => {
    const entry = routes.get(hash);
    return entry && flags.isEnabled(entry.flag) ? entry.render : null;
  };
  return Object.freeze({
    register(path, { flag, render }) {
      if (typeof path !== 'string' || !/^#\/ai\/[a-z0-9][a-z0-9/-]*$/.test(path) || routes.has(path)) {
        throw new TypeError('AI extension route must be unique and under #/ai/');
      }
      if (typeof flag !== 'string' || !flag || typeof render !== 'function') {
        throw new TypeError('Route requires a feature flag and render function');
      }
      routes.set(path, { flag, render });
    },
    resolve,
    async dispatch(hash, context) {
      const render = resolve(hash);
      if (!render) return false;
      await render(context);
      return true;
    }
  });
}
