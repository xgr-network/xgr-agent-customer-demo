import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { clearRun, createRun, getRun, listRuns, stripSubscribers, subscribeRun } from '../demoStateStore.js';
import { runDemo } from '../demoRunner.js';
import { buildSampleDocumentText, SAMPLE_DOCUMENT_NAME } from '../../demo/sampleDocument.js';
import { XGR_CHAINS } from '../../config/xgrChains.js';
import { calculateOstcHashFromBundle, calculateOstcHashFromChain } from '../../xdala/ostcHash.js';
import { getAgentAddress } from '../../xdala/wakeupClient.js';
import { listSessionRows, waitForStepStatus } from '../../xdala/pollSessionStatus.js';
import { startWaiterSession } from '../../xdala/startWaiterSession.js';
import { fetchSessionReceiptReport } from '../../xdala/sessionReceiptReport.js';
import { buildConfiguredWaiterBundleText } from '../../xdala/waiterBundleBuilder.js';
import { checkWaiterSchemaCompatibility } from '../../xdala/waiterCompatibility.js';
import { clearLiveWaiter, getLiveWaiter, saveLiveWaiter, serializeLiveWaiter } from '../liveWaiterStore.js';
import {
  applyRuntimeConfig,
  clearRuntimeConfig,
  getRuntimeConfigStatus,
  lockRuntimeConfig,
  saveRuntimeConfig,
  unlockRuntimeConfig,
} from '../runtimeConfigStore.js';
import { getEnvSecretStatus, lockEnvSecrets, unlockEnvSecrets } from '../secrets/envSecretVault.js';
import { clearUploadedDocument, getUploadedDocument, getUploadedDocumentStatus, saveDocumentText, saveUploadedDocument } from '../documentStore.js';
import { requireWaitingLiveWaiter, serializeLiveWaiterRecord } from '../services/liveWaiterFlowService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');
const waiterBundlePath = path.join(rootDir, 'demo/xdala/document-agent-waiter.multi-bundle.json');
const waiterStartPayloadPath = path.join(rootDir, 'demo/xdala/waiter-start-payload.example.json');
const chainConfigPath = path.join(rootDir, 'demo/xdala/xgr-chain-config.example.json');
const customerApiDocPath = path.join(rootDir, 'demo/docs/customer-integration-api.md');

function sendDownload(res, filePath, filename, contentType = 'application/json; charset=utf-8') {
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `${filename} not found in this build.` });
  }
  res.setHeader('content-type', contentType);
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  return fs.createReadStream(filePath).pipe(res);
}

function sendConfiguredWaiterBundle(res, { schemaText = '', ostcId = 'document_agent_waiter_flow' } = {}) {
  const text = buildConfiguredWaiterBundleText({ schemaText, ostcId });
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="document-agent-waiter.configured.multi-bundle.json"');
  return res.send(text);
}

function readRuntimeSessionId(req) {
  return String(
    req.headers['x-xgr-agent-session']
    || req.query?.runtimeSessionId
    || req.body?.runtimeSessionId
    || 'default'
  ).trim();
}

function readCalculatedOstcHash() {
  return calculateOstcHashFromBundle(waiterBundlePath);
}

function hasPublicRuntimeConfigInput(input = {}) {
  return [
    'chainKey',
    'chainIdHex',
    'rpcUrl',
    'explorerUrl',
    'orchestrationAddress',
    'ostcId',
    'ostcHash',
    'startStepId',
    'waitStepId',
    'aiProvider',
    'openaiModel',
    'geminiModel',
    'documentApiUrl',
    'customDocumentText',
    'customInstructions',
    'resultSchemaText',
  ].some((field) => String(input?.[field] || '').trim());
}

function getExistingWaiterForRun(runtimeSessionId) {
  return requireWaitingLiveWaiter(runtimeSessionId);
}

function buildSecretFlowStatus({ config, runtimeConfig, envSecrets }) {
  const runtimePublic = runtimeConfig?.publicConfig || {};
  const envMeta = envSecrets?.publicMeta || {};
  const openaiConfigured = !!(runtimePublic.hasOpenAiRuntimeKey || envMeta.hasOpenAiApiKey || config.openai?.apiKey);
  const geminiConfigured = !!(runtimePublic.hasGeminiRuntimeKey || envMeta.hasGeminiApiKey || config.gemini?.apiKey);
  const configuredProvider = String(runtimePublic.aiProvider || config.ai?.provider || 'openai').trim().toLowerCase();
  const selectedProvider = runtimePublic.aiProvider
    ? configuredProvider
    : configuredProvider === 'gemini' && geminiConfigured
      ? 'gemini'
      : configuredProvider === 'openai' && openaiConfigured
        ? 'openai'
        : geminiConfigured && !openaiConfigured
          ? 'gemini'
          : openaiConfigured && !geminiConfigured
            ? 'openai'
            : configuredProvider === 'mock'
              ? 'mock'
              : 'openai';
  const openaiUsable = !!(config.openai?.apiKey || (runtimeConfig?.unlocked && runtimePublic.hasOpenAiRuntimeKey) || (envSecrets?.unlocked && envMeta.hasOpenAiApiKey));
  const geminiUsable = !!(config.gemini?.apiKey || (runtimeConfig?.unlocked && runtimePublic.hasGeminiRuntimeKey) || (envSecrets?.unlocked && envMeta.hasGeminiApiKey));
  const providerKeyConfigured = selectedProvider === 'gemini'
    ? geminiConfigured
    : selectedProvider === 'openai'
      ? openaiConfigured
      : true;
  const providerKeyUsable = selectedProvider === 'gemini'
    ? geminiUsable
    : selectedProvider === 'openai'
      ? openaiUsable
      : true;
  const ownerConfigured = !!(envMeta.hasXdalaOwnerPrivateKey || runtimePublic.ownerAddress || config.xdala?.ownerPrivateKey);
  const agentConfigured = !!(envMeta.hasXdalaAgentPrivateKey || runtimeConfig?.configured || config.xdala?.agentPrivateKey);
  const xdalaReady = !!(
    (envMeta.hasXdalaOwnerPrivateKey && envMeta.hasXdalaAgentPrivateKey && envSecrets?.unlocked)
    || (runtimeConfig?.configured && runtimeConfig?.unlocked)
    || (config.xdala?.ownerPrivateKey && config.xdala?.agentPrivateKey)
  );
  const liveReady = !!(xdalaReady && providerKeyUsable);

  return {
    selectedProvider,
    effectiveMode: liveReady ? 'live' : 'mock',
    liveReady,
    providerKeyConfigured,
    providerKeyUsable,
    sources: {
      runtimeConfigured: !!runtimeConfig?.configured,
      runtimeUnlocked: !!runtimeConfig?.unlocked,
      envConfigured: !!envSecrets?.configured,
      envUnlocked: !!envSecrets?.unlocked,
    },
    ai: {
      openaiConfigured,
      geminiConfigured,
    },
    xdala: {
      ownerConfigured,
      agentConfigured,
      ready: xdalaReady,
    },
    document: {
      apiKeyConfigured: !!(runtimePublic.hasDocumentApiKey || envMeta.hasDocumentApiKey || config.document?.apiKey),
    },
  };
}

function buildEnvBackedRuntimeConfig({ config, runtimeConfig, envSecrets, secretFlow }) {
  if (runtimeConfig?.configured || !secretFlow?.liveReady) return runtimeConfig;

  const envMeta = envSecrets?.publicMeta || {};
  return {
    configured: true,
    unlocked: !!envSecrets?.unlocked,
    unlockExpiresAt: Number(envSecrets?.unlockExpiresAt || 0),
    unlockLeftSec: Number(envSecrets?.unlockLeftSec || 0),
    id: 'encrypted-env',
    createdAt: null,
    updatedAt: null,
    hasEncryptedKeys: true,
    source: 'encrypted-env',
    publicConfig: {
      source: 'encrypted-env',
      chainKey: '',
      chainLabel: 'Configured XGR network',
      chainIdHex: '',
      chainIdDec: '',
      rpcUrl: config.xdala?.rpcUrl || '',
      explorerUrl: '',
      orchestrationAddress: config.xdala?.orchestrationAddress || '',
      ostcId: config.xdala?.ostcId || 'document_agent_waiter_flow',
      ostcHash: config.xdala?.ostcHash || '0x' + '00'.repeat(32),
      startStepId: config.xdala?.startStepId || 'ARM_WAIT',
      waitStepId: config.xdala?.waitStepId || 'WAIT_FOR_DOCUMENT',
      aiProvider: secretFlow.selectedProvider || config.ai?.provider || 'openai',
      openaiModel: config.openai?.model || 'gpt-4.1-mini',
      geminiModel: config.gemini?.model || 'gemini-3.5-flash',
      documentApiUrl: config.document?.apiUrl || '',
      customDocumentText: '',
      customInstructions: config.ai?.instructions || '',
      resultSchemaText: config.ai?.resultSchemaText || '',
      connectedWalletAddress: envMeta.ownerAddress || '',
      connectedWalletChainId: '',
      ownerAddress: envMeta.ownerAddress || '',
      hasOpenAiRuntimeKey: !!envMeta.hasOpenAiApiKey,
      hasGeminiRuntimeKey: !!envMeta.hasGeminiApiKey,
      hasDocumentApiKey: !!envMeta.hasDocumentApiKey,
    },
  };
}

export function createDemoRouter(config) {
  const router = express.Router();
  const calculatedOstcHash = readCalculatedOstcHash();

  router.use('/live', (req, res, next) => {
    if (req.method !== 'POST') return next();
    if (String(req.path || '').includes('/demo-state')) return next();
    if (!hasPublicRuntimeConfigInput(req.body)) return next();

    try {
      saveRuntimeConfig(readRuntimeSessionId(req), req.body);
      return next();
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: error.message,
      });
    }
  });

  router.get('/health', (req, res) => {
    res.json({ ok: true, mode: config.mode });
  });

  router.get('/config', (req, res) => {
    const runtimeSessionId = readRuntimeSessionId(req);
    const runtimeConfig = getRuntimeConfigStatus(runtimeSessionId);
    const envSecrets = getEnvSecretStatus();
    const secretFlow = buildSecretFlowStatus({ config, runtimeConfig, envSecrets });
    const effectiveRuntimeConfig = buildEnvBackedRuntimeConfig({ config, runtimeConfig, envSecrets, secretFlow });
    res.json({
      mode: config.mode,
      effectiveMode: secretFlow.effectiveMode,
      aiConfigured: Boolean(
        config.openai.apiKey
        || config.gemini?.apiKey
        || runtimeConfig?.publicConfig?.hasOpenAiRuntimeKey
        || runtimeConfig?.publicConfig?.hasGeminiRuntimeKey
        || envSecrets?.publicMeta?.hasOpenAiApiKey
        || envSecrets?.publicMeta?.hasGeminiApiKey
      ),
      openaiConfigured: Boolean(config.openai.apiKey || runtimeConfig?.publicConfig?.hasOpenAiRuntimeKey || envSecrets?.publicMeta?.hasOpenAiApiKey),
      geminiConfigured: Boolean(config.gemini?.apiKey || runtimeConfig?.publicConfig?.hasGeminiRuntimeKey || envSecrets?.publicMeta?.hasGeminiApiKey),
      openaiModel: runtimeConfig?.publicConfig?.openaiModel || config.openai.model,
      liveConfigured: Boolean(effectiveRuntimeConfig?.configured || envSecrets?.configured),
      waitStepId: config.xdala.waitStepId,
      envSecrets,
      secretFlow,
      ai: {
        provider: runtimeConfig?.publicConfig?.aiProvider || secretFlow.selectedProvider || config.ai?.provider || '',
        openaiModel: runtimeConfig?.publicConfig?.openaiModel || config.openai.model,
        geminiModel: runtimeConfig?.publicConfig?.geminiModel || config.gemini?.model || 'gemini-3.5-flash',
      },
      xdala: {
        rpcUrl: config.xdala.rpcUrl,
        orchestrationAddress: config.xdala.orchestrationAddress,
        ostcId: config.xdala.ostcId,
        startStepId: config.xdala.startStepId,
        waitStepId: config.xdala.waitStepId,
      },
      demoBundle: {
        ostcHash: calculatedOstcHash,
        ostcHashSource: 'demo/xdala/document-agent-waiter.multi-bundle.json',
      },
      chains: XGR_CHAINS,
      runtimeConfig: effectiveRuntimeConfig,
      documentUpload: getUploadedDocumentStatus(runtimeSessionId),
      liveWaiter: serializeLiveWaiter(getLiveWaiter(runtimeSessionId)),
      downloads: {
        waiterBundle: '/api/downloads/waiter-bundle',
        configuredWaiterBundle: '/api/downloads/waiter-bundle-configured',
        waiterStartPayload: '/api/downloads/waiter-start-payload',
        chainConfig: '/api/downloads/chain-config',
        customerApiDoc: '/api/downloads/customer-api-doc',
      },
    });
  });

  router.get('/downloads/waiter-bundle', (req, res) => {
    return sendDownload(res, waiterBundlePath, 'document-agent-waiter.multi-bundle.json');
  });

  router.get('/downloads/waiter-bundle-configured', (req, res) => {
    try {
      const runtimeSessionId = readRuntimeSessionId(req);
      const runtimeConfig = getRuntimeConfigStatus(runtimeSessionId);
      const publicConfig = runtimeConfig?.publicConfig || {};
      return sendConfiguredWaiterBundle(res, {
        schemaText: publicConfig.resultSchemaText || '',
        ostcId: publicConfig.ostcId || 'document_agent_waiter_flow',
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.post('/downloads/waiter-bundle-configured', (req, res) => {
    try {
      return sendConfiguredWaiterBundle(res, {
        schemaText: req.body?.schemaText || '',
        ostcId: req.body?.ostcId || 'document_agent_waiter_flow',
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.get('/downloads/waiter-start-payload', (req, res) => {
    return sendDownload(res, waiterStartPayloadPath, 'waiter-start-payload.example.json');
  });

  router.get('/downloads/chain-config', (req, res) => {
    return sendDownload(res, chainConfigPath, 'xgr-chain-config.example.json');
  });

  router.get('/downloads/customer-api-doc', (req, res) => {
    return sendDownload(res, customerApiDocPath, 'xgr-agent-customer-integration-api.md', 'text/markdown; charset=utf-8');
  });

  router.post('/xdala/check-waiter-schema', async (req, res) => {
    try {
      const result = await checkWaiterSchemaCompatibility({
        rpcUrl: req.body?.rpcUrl,
        orchestrationAddress: req.body?.orchestrationAddress,
        ostcId: req.body?.ostcId,
        waitStepId: req.body?.waitStepId,
        schemaText: req.body?.schemaText,
        ostcHash: req.body?.ostcHash,
      });
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.get('/xdala/ostc-hash', async (req, res) => {
    try {
      const rpcUrl = String(req.query?.rpcUrl || '').trim();
      const orchestrationAddress = String(req.query?.orchestrationAddress || '').trim();
      const ostcId = String(req.query?.ostcId || '').trim();

      const result = await calculateOstcHashFromChain({
        rpcUrl,
        orchestrationAddress,
        ostcId,
      });

      return res.json({
        ok: true,
        source: 'chain',
        ostcHash: result.ostcHash,
        rawLength: result.raw.length,
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.get('/sample-document', (req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${SAMPLE_DOCUMENT_NAME}"`);
    res.send(buildSampleDocumentText());
  });

  router.get('/runtime-config', (req, res) => {
    const runtimeSessionId = readRuntimeSessionId(req);
    res.json({
      runtimeConfig: getRuntimeConfigStatus(runtimeSessionId),
      documentUpload: getUploadedDocumentStatus(runtimeSessionId),
    });
  });

  router.post('/runtime-config', (req, res) => {
    try {
      const runtimeSessionId = readRuntimeSessionId(req);
      saveRuntimeConfig(runtimeSessionId, req.body || {});
      res.json({
        ok: true,
        runtimeConfig: getRuntimeConfigStatus(runtimeSessionId),
        liveWaiter: serializeLiveWaiterRecord(runtimeSessionId),
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.post('/document/upload', express.json({ limit: '10mb' }), (req, res) => {
    try {
      const status = saveUploadedDocument(readRuntimeSessionId(req), req.body || {});
      return res.status(201).json({ ok: true, documentUpload: status });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.post('/document/text', express.json({ limit: '2mb' }), (req, res) => {
    try {
      const status = saveDocumentText(readRuntimeSessionId(req), req.body || {});
      return res.status(201).json({ ok: true, documentUpload: status });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/document/upload', (req, res) => {
    const status = clearUploadedDocument(readRuntimeSessionId(req));
    return res.json({ ok: true, documentUpload: status });
  });

  router.post('/runtime-config/unlock', (req, res) => {
    try {
      const runtimeConfig = unlockRuntimeConfig(readRuntimeSessionId(req), req.body || {});
      res.json({ ok: true, runtimeConfig });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.post('/env-secrets/unlock', (req, res) => {
    try {
      const unlockTtlSec = Number(req.body?.unlockTtlSec || req.body?.ttlSec || 1200);
      const envSecrets = unlockEnvSecrets({
        password: req.body?.password,
        unlockTtlSec,
      });
      return res.json({ ok: true, envSecrets });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.post('/env-secrets/lock', (_req, res) => {
    const envSecrets = lockEnvSecrets();
    return res.json({ ok: true, envSecrets });
  });

  router.post('/runtime-config/lock', (req, res) => {
    try {
      const runtimeConfig = lockRuntimeConfig(readRuntimeSessionId(req));
      res.json({ ok: true, runtimeConfig });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/runtime-config', (req, res) => {
    const runtimeSessionId = readRuntimeSessionId(req);
    clearRuntimeConfig(runtimeSessionId);
    clearLiveWaiter(runtimeSessionId);
    res.json({ ok: true, runtimeConfig: getRuntimeConfigStatus(runtimeSessionId), liveWaiter: serializeLiveWaiter(null) });
  });

  router.delete('/live/demo-state', (req, res) => {
    const runtimeSessionId = readRuntimeSessionId(req);
    const runId = String(req.body?.runId || req.query?.runId || '').trim();

    if (runId) clearRun(runId);

    return res.json({
      ok: true,
      runtimeConfig: getRuntimeConfigStatus(runtimeSessionId),
      liveWaiter: serializeLiveWaiterRecord(runtimeSessionId),
      documentUpload: getUploadedDocumentStatus(runtimeSessionId),
    });
  });

  router.delete('/live/demo-state/full', (req, res) => {
    const runtimeSessionId = readRuntimeSessionId(req);
    const runId = String(req.body?.runId || req.query?.runId || '').trim();

    if (runId) clearRun(runId);
    clearLiveWaiter(runtimeSessionId);
    clearUploadedDocument(runtimeSessionId);
    clearRuntimeConfig(runtimeSessionId);

    return res.json({
      ok: true,
      runtimeConfig: getRuntimeConfigStatus(runtimeSessionId),
      liveWaiter: serializeLiveWaiter(null),
      documentUpload: getUploadedDocumentStatus(runtimeSessionId),
    });
  });

  router.get('/live/waiter', async (req, res) => {
    const runtimeSessionId = readRuntimeSessionId(req);
    try {
      const existing = getLiveWaiter(runtimeSessionId);
      if (!existing?.waiter) {
        return res.json({ ok: true, liveWaiter: serializeLiveWaiter(null) });
      }

      const effectiveConfig = applyRuntimeConfig(config, runtimeSessionId, '');
      const rows = await listSessionRows({ config: effectiveConfig, waiter: existing.waiter });
      const waitStepId = effectiveConfig.xdala.waitStepId;
      const hit = rows.find((row) => {
        const rowStep = String(row.step || row.stepId || row.Step || '').trim();
        const rowStatus = String(row.status || row.Status || '').trim().toLowerCase();
        return rowStep === waitStepId && rowStatus === 'waiting';
      }) || null;

      const saved = saveLiveWaiter(runtimeSessionId, {
        ...existing,
        rows,
        hit,
        waiting: !!hit,
        status: hit ? 'waiting' : 'started',
      });
      return res.json({ ok: true, liveWaiter: serializeLiveWaiter(saved) });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.post('/live/start-waiter', async (req, res) => {
    const runtimeSessionId = readRuntimeSessionId(req);
    try {
      const effectiveConfig = applyRuntimeConfig(config, runtimeSessionId, '');
      const agentAddress = getAgentAddress(effectiveConfig.xdala.agentPrivateKey);
      const waiter = await startWaiterSession({ config: effectiveConfig, agentAddress });
      const waiting = await waitForStepStatus({
        config: effectiveConfig,
        waiter,
        stepId: effectiveConfig.xdala.waitStepId,
        status: 'waiting',
        timeoutMs: Number(req.body?.timeoutMs || 60000),
        pollMs: Number(req.body?.pollMs || 2000),
      });
      const saved = saveLiveWaiter(runtimeSessionId, {
        waiter,
        rows: waiting.rows,
        hit: waiting.hit,
        waiting: true,
        status: 'waiting',
      });
      return res.status(201).json({ ok: true, liveWaiter: serializeLiveWaiter(saved) });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.get('/live/session-receipts', async (req, res) => {
    const runtimeSessionId = readRuntimeSessionId(req);
    try {
      const existing = getLiveWaiter(runtimeSessionId);
      if (!existing?.waiter) {
        return res.status(400).json({ ok: false, error: 'No live waiter session exists for this browser tab. Start the waiter first.' });
      }
      const effectiveConfig = applyRuntimeConfig(config, runtimeSessionId, '');
      const report = await fetchSessionReceiptReport({
        config: effectiveConfig,
        waiter: existing.waiter,
        limit: Number(req.query?.limit || 10000),
        minRows: Number(req.query?.minRows || 0),
        timeoutMs: Number(req.query?.timeoutMs || 0),
        pollMs: Number(req.query?.pollMs || 3000),
      });
      return res.json(report);
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.delete('/live/waiter', (req, res) => {
    clearLiveWaiter(readRuntimeSessionId(req));
    res.json({ ok: true, liveWaiter: serializeLiveWaiter(null) });
  });

  router.get('/runs', (req, res) => {
    res.json({ runs: listRuns() });
  });

  router.post('/runs', (req, res) => {
    try {
      const runtimeSessionId = readRuntimeSessionId(req);
      const effectiveConfig = applyRuntimeConfig(config, runtimeSessionId, req.body?.unlockPassword || '');
      const uploadedDocument = getUploadedDocument(runtimeSessionId);
      if (uploadedDocument) effectiveConfig.document.uploadedDocument = uploadedDocument;
      const run = createRun();
      const existingWaiter = effectiveConfig.mode === 'live'
        ? getExistingWaiterForRun(runtimeSessionId)
        : null;
      res.status(202).json({
        run: stripSubscribers(run),
        liveWaiter: serializeLiveWaiterRecord(runtimeSessionId),
      });
      runDemo({
        runId: run.id,
        config: effectiveConfig,
        existingWaiter,
      }).catch(() => {});
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/runs/:id', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({ run: stripSubscribers(run) });
  });

  router.get('/runs/:id/events', (req, res) => {
    const run = getRun(req.params.id);
    if (!run) return res.status(404).end('Run not found');

    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (payload) => {
      res.write(`event: run\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const unsubscribe = subscribeRun(run.id, send);

    req.on('close', () => {
      unsubscribe();
      res.end();
    });
  });

  return router;
}
