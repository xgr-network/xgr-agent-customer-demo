import { getLiveWaiter, serializeLiveWaiter } from '../liveWaiterStore.js';

function hasWaitingStatus(record) {
  if (!record?.waiter?.sessionId) return false;
  if (record.waiting === true) return true;
  if (!record.status) return true;
  return String(record.status).toLowerCase() === 'waiting';
}

export function getLiveWaiterRecord(runtimeSessionId) {
  return getLiveWaiter(runtimeSessionId);
}

export function serializeLiveWaiterRecord(runtimeSessionId) {
  return serializeLiveWaiter(getLiveWaiterRecord(runtimeSessionId));
}

export function requireWaitingLiveWaiter(runtimeSessionId) {
  const record = getLiveWaiterRecord(runtimeSessionId);

  if (!record?.waiter?.sessionId) {
    throw new Error('Start the live waiter first. The AI run wakes the existing waiter and never creates a new waiter session.');
  }

  if (!hasWaitingStatus(record)) {
    throw new Error(`The stored live waiter is not waiting anymore. Current status: ${record.status || 'unknown'}. Start a new waiter before running the AI wakeup.`);
  }

  return record.waiter;
}
