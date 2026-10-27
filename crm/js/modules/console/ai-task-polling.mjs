const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function resolveAITask(startRequest, statusRequest, taskType, personId,
  { intervalMs = 3000, timeoutMs = 105000 } = {}) {
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
