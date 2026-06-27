export async function rpcCall(rpcUrl, method, params = null) {
  if (!rpcUrl) throw new Error('rpcUrl is required');
  if (!method) throw new Error('RPC method is required');

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params: params == null ? [] : [params],
    }),
  });

  if (!response.ok) {
    throw new Error(`XDaLa RPC HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message || 'XDaLa RPC error');
  }
  return json.result;
}

export function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return '';
  return address;
}

export async function getCoreAddrs(rpcUrl) {
  return rpcCall(rpcUrl, 'xgr_getCoreAddrs', null);
}

export async function getNextProcessId(rpcUrl, owner) {
  const result = await rpcCall(rpcUrl, 'xgr_getNextProcessId', { from: owner });
  return String(result?.nextProcessId ?? result?.NextProcessId ?? result?.processId ?? result);
}
