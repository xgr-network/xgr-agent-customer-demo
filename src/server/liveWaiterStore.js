const waiterRecords = new Map();

function normalizeRuntimeSessionId(value) {
  const id = String(value || '').trim();
  if (!id) throw new Error('Runtime session id missing. Reload the page and try again.');
  return id.slice(0, 128);
}

export function clearLiveWaiter(runtimeSessionId) {
  waiterRecords.delete(normalizeRuntimeSessionId(runtimeSessionId));
}

export function getLiveWaiter(runtimeSessionId) {
  return waiterRecords.get(normalizeRuntimeSessionId(runtimeSessionId)) || null;
}

export function saveLiveWaiter(runtimeSessionId, waiterRecord) {
  const id = normalizeRuntimeSessionId(runtimeSessionId);
  const existing = waiterRecords.get(id) || {};
  const now = new Date().toISOString();
  const record = {
    ...existing,
    ...(waiterRecord || {}),
    runtimeSessionId: id,
    updatedAt: now,
    createdAt: existing.createdAt || now,
  };
  waiterRecords.set(id, record);
  return record;
}

export function serializeLiveWaiter(record) {
  if (!record) {
    return {
      exists: false,
      waiting: false,
      waiter: null,
      rows: [],
      hit: null,
      status: 'not_started',
    };
  }

  const rows = Array.isArray(record.rows) ? record.rows : [];
  return {
    exists: true,
    waiting: !!record.waiting,
    status: record.status || (record.waiting ? 'waiting' : 'started'),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    waiter: record.waiter || null,
    hit: record.hit || null,
    rows,
    rowCount: rows.length,
  };
}
