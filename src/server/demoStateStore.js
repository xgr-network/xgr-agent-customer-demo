const runs = new Map();

export function createRun() {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const run = {
    id,
    status: 'created',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [],
    result: null,
    error: null,
    subscribers: new Set(),
  };
  runs.set(id, run);
  return run;
}

export function getRun(id) {
  return runs.get(id) || null;
}

export function clearRun(id) {
  if (id) runs.delete(String(id));
}

export function listRuns() {
  return Array.from(runs.values()).map(stripSubscribers);
}

export function stripSubscribers(run) {
  if (!run) return null;
  const { subscribers, ...safe } = run;
  return safe;
}

export function updateRun(id, updater) {
  const run = getRun(id);
  if (!run) return null;
  updater(run);
  run.updatedAt = new Date().toISOString();
  const payload = stripSubscribers(run);
  for (const send of run.subscribers) send(payload);
  return run;
}

export function subscribeRun(id, send) {
  const run = getRun(id);
  if (!run) return () => {};
  run.subscribers.add(send);
  send(stripSubscribers(run));
  return () => run.subscribers.delete(send);
}
