const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function resolveAITask(startRequest, statusRequest, taskType, personId,
  { intervalMs = 3000, timeoutMs = 105000, startupTimeoutMs = 12000, statusTimeoutMs = 10000,
    recoverStartup = false } = {}) {
  if (!recoverStartup) {
    const initial = await startRequest();
    if (initial?.status !== 'pending') {
      if (initial?.ok === false) throw failure(initial.error?.code || 'AI_REQUEST_FAILED');
      return initial;
    }
    const taskId = String(initial.taskId || '');
    if (!/^[1-9][0-9]*$/.test(taskId)) throw failure('AI_AUDIT_UNKNOWN');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
      const status = await statusRequest({ taskId, personId: String(personId), taskType });
      if (status?.status === 'completed' && status.ok === true) return status;
      if (status?.status === 'failed' || status?.ok === false) {
        throw failure(status?.error?.code || 'AI_REQUEST_FAILED');
      }
      if (status?.status !== 'pending') throw failure('AI_AUDIT_UNKNOWN');
    }
    throw failure('AI_TASK_TIMEOUT');
  }
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  const startup = Promise.resolve().then(startRequest).then(
    value => ({ value }), error => ({ error }));
  let startupTimer;
  const startupWait = new Promise(resolve => {
    startupTimer = setTimeout(() => resolve({ timedOut: true }),
      Math.max(0, Math.min(startupTimeoutMs, deadline - Date.now())));
  });
  const first = await Promise.race([startup, startupWait]);
  clearTimeout(startupTimer);
  if (first.error) throw first.error;
  if (!first.timedOut && first.value?.status !== 'pending') {
    if (first.value?.ok === false) throw failure(first.value.error?.code || 'AI_REQUEST_FAILED');
    return first.value;
  }
  let taskId = first.timedOut ? '' : String(first.value?.taskId || '');
  if (!first.timedOut && !/^[1-9][0-9]*$/.test(taskId)) throw failure('AI_AUDIT_UNKNOWN');
  while (Date.now() < deadline) {
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let statusTimer;
    const statusPromise = Promise.resolve().then(() => statusRequest({
      taskId, personId: String(personId), taskType, ...(!taskId ? { startedAt, fallbackLookup: true } : {}),
    })).then(value => ({ value }), error => ({ error }));
    const statusWait = new Promise(resolve => {
      statusTimer = setTimeout(() => resolve({ timedOut: true }),
        Math.max(0, Math.min(statusTimeoutMs, remaining)));
    });
    const checked = await Promise.race([statusPromise, statusWait]);
    clearTimeout(statusTimer);
    if (checked.timedOut) continue;
    if (checked.error) throw checked.error;
    const status = checked.value;
    if (status?.taskId && /^[1-9][0-9]*$/.test(String(status.taskId))) taskId = String(status.taskId);
    if (status?.status === 'completed' && status.ok === true) return status;
    if (status?.status === 'failed' || status?.ok === false) {
      throw failure(status?.error?.code || 'AI_REQUEST_FAILED');
    }
    if (status?.status !== 'pending' && status?.status !== 'starting') throw failure('AI_AUDIT_UNKNOWN');
  }
  throw failure('AI_TASK_TIMEOUT');
}
