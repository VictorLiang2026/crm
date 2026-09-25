// New features are disabled unless the host explicitly enables them.
export function createFeatureFlags(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Feature flags must be an object');
  }
  const flags = Object.create(null);
  for (const [name, enabled] of Object.entries(config)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || typeof enabled !== 'boolean') {
      throw new TypeError('Invalid feature flag');
    }
    flags[name] = enabled;
  }
  Object.freeze(flags);
  return Object.freeze({
    isEnabled(name) { return flags[name] === true; },
    snapshot() { return { ...flags }; }
  });
}
