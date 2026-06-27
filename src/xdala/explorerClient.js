function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function requireExplorerBase(explorerUrl) {
  const base = trimSlash(explorerUrl);
  if (!base) throw new Error('Explorer URL is required. Configure it in Step 1/2.');
  if (!/^https?:\/\//i.test(base)) throw new Error('Explorer URL must start with http:// or https://.');
  return base;
}

export function buildSessionReceiptsUrl({ explorerUrl, sessionId, owner, includeTx = true, includeBlock = true, limit = 10000, filters = {} }) {
  if (!sessionId) throw new Error('sessionId required');
  if (!owner) throw new Error('owner required');
  const base = requireExplorerBase(explorerUrl);
  const params = new URLSearchParams({
    sessionId: String(sessionId),
    owner: String(owner).toLowerCase(),
    includeTx: String(!!includeTx),
    includeBlock: String(!!includeBlock),
    limit: String(Math.max(1, Math.min(Number(limit) || 10000, 10000))),
  });
  if (filters?.iteration != null) params.set('iteration', String(filters.iteration));
  if (filters?.stepId) params.set('step', String(filters.stepId));
  if (typeof filters?.valid === 'boolean') params.set('valid', String(filters.valid));
  return `${base}/api/secure/receipts/bulk?${params.toString()}`;
}

export async function fetchSessionReceipts({ explorerUrl, sessionId, owner, includeTx = true, includeBlock = true, limit = 10000, filters = {} }) {
  const url = buildSessionReceiptsUrl({ explorerUrl, sessionId, owner, includeTx, includeBlock, limit, filters });
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error || body?.message || JSON.stringify(body);
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new Error(detail ? `Explorer HTTP ${response.status}: ${detail}` : `Explorer HTTP ${response.status}`);
  }
  return response.json();
}
