import { Agent, run, setDefaultOpenAIKey, setTracingDisabled } from '@openai/agents';
import { DOCUMENT_AGENT_INSTRUCTIONS } from './documentAgentInstructions.js';
import { buildDocumentAiDebug, buildDocumentAiInput, buildDocumentTaskPrompt } from './documentAiInput.js';
import {
  buildSchemaDebugText,
  buildZodSchemaFromJsonSchema,
  DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA,
  normalizeExtraction,
  resolveResultJsonSchema,
} from './documentExtractionSchema.js';
import { runGeminiDocumentExtractionAgent } from './geminiDocumentAgent.js';

setTracingDisabled(true);

let agentKeyQueue = Promise.resolve();

function summarizeOpenAIError(error) {
  const status = error?.status || error?.response?.status || '';
  const code = error?.code || error?.error?.code || '';
  const type = error?.type || error?.error?.type || '';
  const message = String(error?.message || error?.error?.message || error || 'OpenAI request failed.').replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***');
  return [status ? `status=${status}` : '', code ? `code=${code}` : '', type ? `type=${type}` : '', message]
    .filter(Boolean)
    .join(' | ');
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeAiProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'gemini' || provider === 'google') return 'gemini';
  if (provider === 'openai' || provider === 'openai-agents-sdk') return 'openai';
  if (provider === 'mock') return 'mock';
  return '';
}

export function resolveAiProvider(config, forceMock = false) {
  if (forceMock) return 'mock';
  const explicit = normalizeAiProvider(config?.ai?.provider);
  if (explicit) return explicit;
  if (String(config?.gemini?.apiKey || '').trim()) return 'gemini';
  if (String(config?.openai?.apiKey || '').trim()) return 'openai';
  return 'mock';
}

export function getAiProviderLabel(provider) {
  if (provider === 'gemini') return 'gemini-api';
  if (provider === 'openai') return 'openai-agents-sdk';
  return 'mock';
}

export function getAiProofExtractorLabel(provider) {
  if (provider === 'gemini') return 'gemini-agent';
  if (provider === 'openai') return 'openai-agent';
  return 'mock-extractor';
}

export function getAiModelLabel(config, provider) {
  if (provider === 'gemini') return String(config?.gemini?.model || 'gemini-3.5-flash').trim();
  if (provider === 'openai') return String(config?.openai?.model || 'gpt-4.1-mini').trim();
  return 'mock-extractor';
}

export function getAiErrorHint(provider) {
  if (provider === 'gemini') {
    return 'Check the Gemini API key, AI Studio project quota, model name, and Gemini API access.';
  }
  if (provider === 'openai') {
    return 'Check the OpenAI API key, project permissions for multimodal Responses input, billing/quota, and model access.';
  }
  return 'Mock extraction should not fail. Check the document configuration.';
}

function resolveInstructions(config) {
  return String(config?.ai?.instructions || DOCUMENT_AGENT_INSTRUCTIONS).trim();
}

function resolveSchema(config) {
  return resolveResultJsonSchema(config?.ai?.resultSchemaText || '');
}

export function buildOpenAiDocumentPrompt({ instructions, schema }) {
  return buildDocumentTaskPrompt({
    instructions: instructions || DOCUMENT_AGENT_INSTRUCTIONS,
    schemaDebugText: buildSchemaDebugText(schema),
  });
}

function buildOpenAiAgentInput({ prompt, documentInput }) {
  if (documentInput.text) {
    return `${prompt}\n\nDOCUMENT TEXT:\n${documentInput.text}`;
  }

  const attachment = documentInput.contentType.startsWith('image/')
    ? { type: 'input_image', image: documentInput.dataUrl }
    : { type: 'input_file', file: documentInput.dataUrl, providerData: { filename: documentInput.name } };

  return [{
    role: 'user',
    content: [
      { type: 'input_text', text: prompt },
      attachment,
    ],
  }];
}

export function getStaticDemoExtractionResult(schema = DEFAULT_DOCUMENT_EXTRACTION_JSON_SCHEMA) {
  const out = {};
  for (const [key, spec] of Object.entries(schema?.properties || {})) {
    const type = String(spec?.type || 'string').toLowerCase();
    const lower = key.toLowerCase();
    if (lower.includes('insurance')) out[key] = 'KV-123456789';
    else if (lower.includes('date')) out[key] = '2026-05-20';
    else if (lower.includes('confidence')) out[key] = 1;
    else if (lower.includes('evidence')) out[key] = 'Static demo value. No document parsing or AI call was executed.';
    else if (type === 'number' || type === 'integer') out[key] = 0;
    else if (type === 'boolean') out[key] = true;
    else out[key] = lower.includes('type') ? 'confirmation letter' : 'static demo value';
  }
  return out;
}

async function withScopedOpenAIKey(apiKey, task) {
  const previousQueue = agentKeyQueue.catch(() => {});
  let releaseQueue = () => {};
  agentKeyQueue = new Promise((resolve) => {
    releaseQueue = resolve;
  });

  await previousQueue;

  const previousEnvKey = process.env.OPENAI_API_KEY;
  try {
    if (apiKey) {
      process.env.OPENAI_API_KEY = apiKey;
      setDefaultOpenAIKey(apiKey);
    }
    return await task();
  } finally {
    if (previousEnvKey) {
      process.env.OPENAI_API_KEY = previousEnvKey;
      setDefaultOpenAIKey(previousEnvKey);
    } else {
      delete process.env.OPENAI_API_KEY;
      setDefaultOpenAIKey(undefined);
    }
    releaseQueue();
  }
}

async function runOpenAiDocumentExtractionAgent({ document, config }) {
  const apiKey = String(config?.openai?.apiKey || '').trim();
  if (!apiKey) throw new Error('OpenAI API key missing.');

  return withScopedOpenAIKey(apiKey, async () => {
    const model = String(config?.openai?.model || 'gpt-4.1-mini').trim();
    const instructions = resolveInstructions(config);
    const schema = resolveSchema(config);
    const documentInput = buildDocumentAiInput(document);
    const prompt = buildOpenAiDocumentPrompt({ instructions, schema });
    const agentInput = buildOpenAiAgentInput({ prompt, documentInput });
    const agent = new Agent({
      name: 'XGR Document Extraction Agent',
      instructions,
      model,
      outputType: buildZodSchemaFromJsonSchema(schema),
    });

    try {
      const result = await withTimeout(run(agent, agentInput), 45000, 'OpenAI document extraction');
      const extraction = normalizeExtraction(result.finalOutput, schema);
      return {
        extraction,
        debug: {
          provider: 'openai',
          providerLabel: 'openai-agents-sdk',
          model,
          instructions,
          prompt,
          document: buildDocumentAiDebug(documentInput),
          rawAnswer: JSON.stringify(result.finalOutput, null, 2),
          outputSchema: buildSchemaDebugText(schema),
          parsedAnswer: extraction,
        },
      };
    } catch (error) {
      const summary = summarizeOpenAIError(error);
      console.error(`OpenAI document extraction failed: ${summary}`);
      throw new Error(`OpenAI document extraction failed: ${summary}`);
    }
  });
}

export async function runDocumentExtractionAgent({ document, config, forceMock = false }) {
  const provider = resolveAiProvider(config, forceMock);
  const instructions = resolveInstructions(config);
  const schema = resolveSchema(config);
  if (provider === 'mock') {
    const extraction = normalizeExtraction(getStaticDemoExtractionResult(schema), schema);
    const prompt = [
      'Static demo mode does not inspect or parse the document.',
      'It returns a fixed sample result so the UI and XDaLa wakeup flow can be tested without an AI provider.',
    ].join('\n');
    return {
      extraction,
      debug: {
        provider: 'mock',
        providerLabel: 'mock',
        model: 'mock-extractor',
        instructions: 'Static demo result. No local regex, parser, or external AI call is used.',
        prompt,
        document: document?.bytes ? buildDocumentAiDebug(buildDocumentAiInput(document)) : null,
        rawAnswer: JSON.stringify(extraction, null, 2),
        outputSchema: buildSchemaDebugText(schema),
        parsedAnswer: extraction,
      },
    };
  }

  if (provider === 'gemini') {
    return runGeminiDocumentExtractionAgent({
      document,
      apiKey: config?.gemini?.apiKey,
      model: config?.gemini?.model,
      instructions,
      resultSchema: schema,
    });
  }

  return runOpenAiDocumentExtractionAgent({ document, config });
}
