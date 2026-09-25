// New modules receive the existing authenticated callFn at their integration point.
// No SDK, database or model client is created here.
export function createApi(callFn) {
  if (typeof callFn !== 'function') throw new TypeError('A callFn bridge is required');
  return Object.freeze({
    call(name, data = {}) {
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name) || name.startsWith('pr_')) {
        throw new TypeError('Invalid CRM function name');
      }
      return callFn(name, data);
    }
  });
}
