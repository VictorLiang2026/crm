'use strict';

// The configured function limit is 60s. Preserve time to return existing facts
// even when the SDK/model ignores its request timeout. No retry or business write.
const AI_WAIT_MS = 40000;
const RESPONSE_DEADLINE_MS = 50000;
async function waitForTodayAi(work, startedAt, clock = {}) {
  const now = clock.now || Date.now;
  const schedule = clock.schedule || setTimeout;
  const cancel = clock.cancel || clearTimeout;
  const budget = Math.min(AI_WAIT_MS, RESPONSE_DEADLINE_MS - (now() - startedAt));
  const timeout = () => new Error('TODAY_AI_TIMEOUT');
  if (budget <= 0) throw timeout();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => { timer = schedule(() => reject(timeout()), budget); })
    ]);
  } finally { if (timer !== undefined) cancel(timer); }
}
module.exports = { waitForTodayAi };
