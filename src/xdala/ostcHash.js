import fs from 'fs';
import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
import { buildDeployableXrc729Payload } from './xrc729DeployablePayload.js';

const GET_OSTC_ABI = [
  {
    inputs: [{ internalType: 'string', name: 'id', type: 'string' }],
    name: 'getOSTC',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
];

function encodeCanonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(encodeCanonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${encodeCanonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function keccakCanonical(value) {
  return keccak256(toUtf8Bytes(encodeCanonical(value)));
}

export function calculateOstcHashFromJsonText(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) throw new Error('OSTC JSON is empty.');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The XRC-729 contract returned OSTC data, but it is not valid JSON. Check the OSTC ID and deployed contract.');
  }
  const deployable = buildDeployableXrc729Payload(parsed);
  return keccakCanonical(deployable);
}

export function loadWaiterOrchestrationFromBundle(bundlePath) {
  const raw = fs.readFileSync(bundlePath, 'utf8');
  const parsed = JSON.parse(raw);
  const bundles = Array.isArray(parsed?.bundles) ? parsed.bundles : [];
  for (const bundle of bundles) {
    const items = Array.isArray(bundle?.items) ? bundle.items : [];
    const hit = items.find((item) => String(item?.meta?.type || '').toLowerCase() === 'xrc729');
    if (hit) return hit;
  }
  throw new Error('No XRC-729 orchestration item found in waiter bundle.');
}

export function calculateOstcHashFromBundle(bundlePath) {
  const deployable = buildDeployableXrc729Payload(loadWaiterOrchestrationFromBundle(bundlePath));
  return keccakCanonical(deployable);
}

function toUserFacingOstcReadError(error) {
  const rawMessage = String(error?.shortMessage || error?.reason || error?.message || '').trim();
  const rawCode = String(error?.code || '').trim();

  if (rawCode === 'BAD_DATA' || rawMessage.includes('could not decode result data')) {
    return 'This address is not a compatible XRC-729 contract. It does not expose getOSTC(string).';
  }

  if (rawCode === 'CALL_EXCEPTION' || rawMessage.includes('execution reverted') || rawMessage.includes('missing revert data')) {
    return 'Could not read OSTC data. The address is not a compatible XRC-729 contract, or the OSTC ID does not exist on this contract.';
  }

  if (rawCode === 'NETWORK_ERROR' || rawCode === 'SERVER_ERROR' || rawMessage.includes('failed to fetch')) {
    return 'Could not reach the selected RPC URL. Check the network and RPC endpoint.';
  }

  return 'Could not read OSTC data from the selected XRC-729 contract. Check the network, contract address, and OSTC ID.';
}

export async function fetchOstcJsonFromChain({ rpcUrl, orchestrationAddress, ostcId }) {
  const rpc = String(rpcUrl || '').trim();
  const address = String(orchestrationAddress || '').trim().toLowerCase();
  const id = String(ostcId || '').trim();
  if (!rpc) throw new Error('RPC URL is required to load the deployed OSTC.');
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('XRC-729 address is invalid.');
  if (!id) throw new Error('OSTC ID is required.');

  const provider = new JsonRpcProvider(rpc);
  let code = '';
  try {
    code = await provider.getCode(address);
  } catch (error) {
    throw new Error(toUserFacingOstcReadError(error));
  }
  if (!code || code === '0x') {
    throw new Error('No contract found at this address on the selected network. Check the network and XRC-729 address.');
  }

  const contract = new Contract(address, GET_OSTC_ABI, provider);
  let json = '';
  try {
    json = await contract.getOSTC(id);
  } catch (error) {
    throw new Error(toUserFacingOstcReadError(error));
  }

  if (typeof json !== 'string' || !json.trim()) {
    throw new Error('The XRC-729 contract returned empty OSTC data for this OSTC ID. Check the OSTC ID.');
  }
  return json;
}

export async function calculateOstcHashFromChain(options = {}) {
  const raw = await fetchOstcJsonFromChain(options);
  return {
    ostcHash: calculateOstcHashFromJsonText(raw),
    raw,
  };
}
