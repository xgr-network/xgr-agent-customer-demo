import { DOCUMENT_AGENT_INSTRUCTIONS } from './documentAgentInstructions.js';
import { buildDocumentAiDebug, buildDocumentAiInput, buildDocumentTaskPrompt } from './documentAiInput.js';
import { buildSchemaDebugText, normalizeExtraction, resolveResultJsonSchema, toProviderJsonSchema } from './documentExtractionSchema.js';

function summarizeGeminiError(error) {
  const status = error?.status || error?.response?.status || '';
  const code = error?.code || error?.error?.code || error?.error?.status || '';
  const type = error?.type || error?.error?.type || '';
  const message = String(error?.message || error?.error?.message || error || 'Gemini request failed.')
    .replace(/AIza[0-9A-Za-z_-]+/g, 'AIza***');
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

function stripJsonFence(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : raw;
}

function parseGeminiJson(text) {
  const cleaned = stripJsonFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    throw error;
  }
}

function readResponseText(response) {
  const value = response?.text;
  if (typeof value === 'function') return String(value.call(response) || '');
  if (typeof value === 'string') return value;
  const partText = response?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    ?.join('') || '';
  return String(partText || '');
}

export function buildGeminiDocumentPrompt({ instructions, schema }) {
  return buildDocumentTaskPrompt({
    instructions: instructions || DOCUMENT_AGENT_INSTRUCTIONS,
    schemaDebugText: buildSchemaDebugText(schema),
  });
}

function buildGeminiContents({ prompt, documentInput }) {
  const parts = [{ text: prompt }];
  if (documentInput.text) {
    parts.push({ text: `DOCUMENT TEXT:\n${documentInput.text}` });
  } else {
    parts.push({
      inlineData: {
        mimeType: documentInput.contentType,
        data: documentInput.bytesBase64,
      },
    });
  }
  return [{ role: 'user', parts }];
}

export async function runGeminiDocumentExtractionAgent({ document, apiKey, model, instructions, resultSchema }) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Gemini API key missing.');

  const selectedModel = String(model || 'gemini-3.5-flash').trim();
  const schema = resolveResultJsonSchema(resultSchema ? JSON.stringify(resultSchema) : '');
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({ apiKey: key });
  const documentInput = buildDocumentAiInput(document);
  const prompt = buildGeminiDocumentPrompt({ instructions, schema });
  const contents = buildGeminiContents({ prompt, documentInput });

  try {
    const response = await withTimeout(
      client.models.generateContent({
        model: selectedModel,
        contents,
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: toProviderJsonSchema(schema),
        },
      }),
      45000,
      'Gemini document extraction',
    );
    const rawAnswer = readResponseText(response);
    const parsed = parseGeminiJson(rawAnswer);
    const extraction = normalizeExtraction(parsed, schema);
    return {
      extraction,
      debug: {
        provider: 'gemini',
        providerLabel: 'gemini-api',
        model: selectedModel,
        instructions: instructions || DOCUMENT_AGENT_INSTRUCTIONS,
        prompt,
        document: buildDocumentAiDebug(documentInput),
        rawAnswer,
        outputSchema: buildSchemaDebugText(schema),
        parsedAnswer: extraction,
      },
    };
  } catch (error) {
    const summary = summarizeGeminiError(error);
    console.error(`Gemini document extraction failed: ${summary}`);
    throw new Error(`Gemini document extraction failed: ${summary}`);
  }
}
