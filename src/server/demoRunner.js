import { Wallet } from 'ethers';
import { assertLiveConfig } from '../config/env.js';
import { fetchDocument } from '../document/fetchDocument.js';
import { hashDocumentBytes } from '../document/hashDocument.js';
import { buildWakeupPayload } from '../document/buildWakeupPayload.js';
import { getAiErrorHint, getAiModelLabel, getAiProofExtractorLabel, getAiProviderLabel, resolveAiProvider, runDocumentExtractionAgent } from '../agent/documentAgent.js';
import { resolveResultJsonSchema } from '../agent/documentExtractionSchema.js';
import { getAgentAddress, wakeXdalaSession } from '../xdala/wakeupClient.js';
import { waitForStepStatus, listSessionRows } from '../xdala/pollSessionStatus.js';
import { updateRun } from './demoStateStore.js';

function redact(value) {
  const s = String(value || '');
  if (s.length <= 16) return s;
  return `${s.slice(0, 10)}...${s.slice(-6)}`;
}

function pushStep(runId, id, title, status, details = {}) {
  updateRun(runId, (run) => {
    const existing = run.steps.find((step) => step.id === id);
    const entry = {
      id,
      title,
      status,
      details,
      updatedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, entry);
    else run.steps.push(entry);
    run.status = status === 'failed' ? 'failed' : run.status === 'completed' ? 'completed' : 'running';
  });
}

async function runMockDemo({ runId, config }) {
  pushStep(runId, 'start_waiter', 'Start waiter session', 'running');
  await new Promise((resolve) => setTimeout(resolve, 700));
  const agentAddress = '0xagent000000000000000000000000000000000001';
  const waiter = {
    sessionId: '1001',
    owner: '0xowner000000000000000000000000000000000001',
    stepId: config.xdala.waitStepId,
  };
  pushStep(runId, 'start_waiter', 'Start waiter session', 'done', {
    sessionId: waiter.sessionId,
    owner: waiter.owner,
    allowlistedAgent: agentAddress,
  });

  pushStep(runId, 'wait_until_waiting', `Wait until ${config.xdala.waitStepId}`, 'running');
  await new Promise((resolve) => setTimeout(resolve, 700));
  pushStep(runId, 'wait_until_waiting', `Wait until ${config.xdala.waitStepId}`, 'done', {
    status: 'waiting',
    stepId: config.xdala.waitStepId,
  });

  return runDocumentFlow({ runId, config, waiter, forceMock: true, liveWakeup: false });
}

async function runLiveDemo({ runId, config, existingWaiter = null }) {
  assertLiveConfig(config);
  const agentAddress = getAgentAddress(config.xdala.agentPrivateKey);

  if (!existingWaiter?.sessionId) {
    throw new Error('No live waiter session is available for this run. Start the live waiter first, then run the AI wakeup on that waiter.');
  }

  const waiter = existingWaiter;
  pushStep(runId, 'start_waiter', 'Use existing waiter session', 'done', {
    mode: 'live',
    sessionId: waiter.sessionId,
    owner: waiter.owner,
    chainId: waiter.chainId,
    waitStepId: config.xdala.waitStepId,
    allowlistedAgent: redact(agentAddress),
  });

  pushStep(runId, 'wait_until_waiting', `Wait until ${config.xdala.waitStepId}`, 'running');
  const waiting = await waitForStepStatus({
    config,
    waiter,
    stepId: config.xdala.waitStepId,
    status: 'waiting',
  });
  pushStep(runId, 'wait_until_waiting', `Wait until ${config.xdala.waitStepId}`, 'done', {
    status: 'waiting',
    rowCount: waiting.rows.length,
  });

  return runDocumentFlow({ runId, config, waiter, forceMock: false, liveWakeup: true });
}

async function runDocumentFlow({ runId, config, waiter, forceMock, liveWakeup }) {
  pushStep(runId, 'fetch_document', 'Fetch document from API', 'running');
  const document = await fetchDocument(config.document);
  pushStep(runId, 'fetch_document', 'Fetch document from API', 'done', {
    name: document.name,
    source: document.source,
    contentType: document.contentType,
    sizeBytes: document.bytes.length,
  });

  pushStep(runId, 'prepare_document', 'Prepare document for AI analysis', 'done', {
    name: document.name,
    source: document.source,
    contentType: document.contentType,
    sizeBytes: document.bytes.length,
  });

  const aiProvider = resolveAiProvider(config, forceMock);
  const aiProviderLabel = getAiProviderLabel(aiProvider);
  const aiModel = getAiModelLabel(config, aiProvider);
  pushStep(runId, 'ai_extract', 'AI Agent extracts business data', 'running', {
    model: aiModel,
    provider: aiProviderLabel,
  });
  let extraction;
  let agentDebug;
  try {
    const aiResult = await runDocumentExtractionAgent({ document, config, forceMock });
    extraction = aiResult.extraction;
    agentDebug = aiResult.debug;
  } catch (error) {
    pushStep(runId, 'ai_extract', 'AI Agent extracts business data', 'failed', {
      model: aiModel,
      provider: aiProviderLabel,
      message: error.message,
      hint: getAiErrorHint(aiProvider),
    });
    throw error;
  }
  pushStep(runId, 'ai_extract', 'AI Agent extracts business data', 'done', {
    provider: aiProviderLabel,
    model: aiModel,
    insuranceNumber: extraction.insuranceNumber,
    documentDate: extraction.documentDate,
    documentType: extraction.documentType,
    confidence: extraction.confidence,
    evidence: extraction.evidence,
    agentDebug,
  });

  pushStep(runId, 'hash_document', 'Create deterministic document proof', 'running');
  const documentHash = hashDocumentBytes(document.bytes);
  const resultSchema = resolveResultJsonSchema(config?.ai?.resultSchemaText || '');
  const wakeupPayload = buildWakeupPayload({
    document,
    documentHash,
    extraction,
    extractedBy: getAiProofExtractorLabel(aiProvider),
    resultSchema,
  });
  pushStep(runId, 'hash_document', 'Create deterministic document proof', 'done', {
    documentHash,
    hashAlgorithm: 'sha256',
    wakeupPayload,
  });

  pushStep(runId, 'wake_xdala', 'Wake XDaLa waiter session', 'running');
  let wakeupResult;
  if (liveWakeup) {
    wakeupResult = await wakeXdalaSession({ config, waiter, payload: wakeupPayload });
  } else {
    await new Promise((resolve) => setTimeout(resolve, 900));
    wakeupResult = {
      sessionId: waiter.sessionId,
      runner: waiter.owner,
      stepId: config.xdala.waitStepId,
      result: { ok: true, woken: 1, mode: 'mock' },
    };
  }
  pushStep(runId, 'wake_xdala', 'Wake XDaLa waiter session', 'done', wakeupResult);

  let finalRows = [];
  if (liveWakeup) {
    try {
      finalRows = await listSessionRows({ config, waiter });
    } catch (error) {
      finalRows = [{ note: `Final list failed: ${error.message}` }];
    }
  } else {
    finalRows = [
      { step: config.xdala.startStepId, status: 'done' },
      { step: config.xdala.waitStepId, status: 'done' },
      { step: 'DONE', status: 'done' },
    ];
  }

  updateRun(runId, (run) => {
    run.status = 'completed';
    run.result = {
      mode: config.mode,
      waiter,
      extraction,
      resultSchema: config?.ai?.resultSchemaText || '',
      agent: {
        provider: aiProvider,
        providerLabel: aiProviderLabel,
        model: aiModel,
        extractedBy: getAiProofExtractorLabel(aiProvider),
      },
      agentDebug,
      document: {
        name: document.name,
        hash: documentHash,
        sizeBytes: document.bytes.length,
      },
      wakeupPayload,
      wakeupResult,
      finalRows,
    };
  });
}

export async function runDemo({ runId, config, existingWaiter = null }) {
  updateRun(runId, (run) => {
    run.status = 'running';
    run.mode = config.mode;
  });

  try {
    if (config.mode === 'live') {
      await runLiveDemo({ runId, config, existingWaiter });
    } else {
      await runMockDemo({ runId, config });
    }
  } catch (error) {
    pushStep(runId, 'error', 'Demo failed', 'failed', {
      message: error.message,
    });
    updateRun(runId, (run) => {
      run.status = 'failed';
      run.error = error.message;
    });
  }
}
