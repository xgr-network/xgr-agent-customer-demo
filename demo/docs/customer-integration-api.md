# Customer Integration API

This page explains the full demo API surface so a customer can rebuild the example in its own backend. The demo connects three parts: a document API, an AI extraction agent, and an XDaLa/XGR blockchain waiter session.

## What this example proves

- A backend can fetch or receive a business document.
- An AI agent can extract a strict JSON result from that document.
- The backend can create a deterministic document proof with a SHA-256 hash.
- The owner wallet can start an XDaLa waiter session.
- The agent wallet can wake the waiting step with the AI result and document proof.
- A customer can read session status and explorer receipts after the wakeup.

## Trust model and multiuser scope

The browser demo is only the example shell. The secure flow is backend-first. Private keys, AI API keys, and document API tokens are never needed in React business logic.

Every tab uses a `runtimeSessionId`. The frontend sends it in the `x-xgr-agent-session` header. Backend runtime secrets, uploaded documents, and live waiter state are stored under that ID. This keeps customer demos multiuser-safe and avoids shared global secrets.

Do not copy this demo as a public secret store. In a company setup, replace the in-memory store with the company's secret manager, IAM, vault, or KMS. Keep the API shape and session separation.

## High-level architecture

1. The customer backend provides a document or accepts a browser upload.
2. The AI agent extracts business fields using the configured result schema.
3. The backend hashes the original document bytes with SHA-256.
4. The owner wallet signs a `SessionPermit` and starts the XDaLa waiter session.
5. The session start payload allowlists the agent wallet for the waiting step.
6. The agent wallet signs a `ControlPermitV2` and calls `xgr_wakeUpProcess`.
7. The UI reads XDaLa session rows and Explorer receipts.

## Local demo HTTP APIs

All endpoints below are relative to `/api`.

### Health and public configuration

- `GET /health` returns `{ ok, mode }`.
- `GET /config` returns public demo config, selected AI provider status, runtime secret status, env secret status, selected chain config, and current document upload status.
- `GET /sample-document` returns the built-in sample document text used when no upload, manual text, or external document API is configured.

### Runtime secret APIs

Use these APIs for tab-scoped encrypted runtime overrides. The frontend sends `x-xgr-agent-session` for every request.

- `GET /runtime-config` returns whether a runtime config exists and whether it is unlocked.
- `POST /runtime-config` saves public runtime config plus secret values. Secret values are encrypted with `runtimePassword` and cleared from the browser fields after save.
- `POST /runtime-config/unlock` unlocks a saved runtime config for a TTL.
- `POST /runtime-config/lock` locks the runtime config immediately.
- `DELETE /runtime-config` deletes the runtime config for this tab/session.
- `POST /env-secrets/unlock` unlocks encrypted server-side `.env` secrets.
- `POST /env-secrets/lock` locks encrypted server-side `.env` secrets.

Typical `POST /runtime-config` input:

```json
{
  "runtimeSessionId": "browser-tab-id",
  "chainKey": "devnet",
  "rpcUrl": "https://rpc1.devnet.xgr.network",
  "explorerUrl": "https://explorer.devnet.xgr.network",
  "orchestrationAddress": "0x...",
  "ostcId": "document_agent_waiter_flow",
  "ostcHash": "0x...",
  "startStepId": "ARM_WAIT",
  "waitStepId": "WAIT_FOR_DOCUMENT",
  "aiProvider": "openai",
  "openaiModel": "gpt-4.1-mini",
  "openaiApiKey": "sk-...",
  "documentApiUrl": "https://customer.example/api/document/123",
  "documentApiKey": "customer-token",
  "ownerPrivateKey": "0x...",
  "agentPrivateKey": "0x...",
  "runtimePassword": "min-8-characters",
  "unlockTtlSec": 1200,
  "resultSchemaText": "{...json schema...}"
}
```

### Document APIs

- `POST /document/upload` stores one uploaded document for the current `runtimeSessionId`. Input: `{ name, contentType, base64 }`.
- `POST /document/text` stores manual UTF-8 text as the active document. Input: `{ text, name? }`.
- `DELETE /document/upload` clears the active uploaded or manual document.

Document source priority is: browser upload, manual text, external `documentApiUrl`, built-in sample.

### Bundle and waiter helper APIs

- `GET /downloads/waiter-bundle` downloads the static example multi-bundle.
- `GET /downloads/waiter-bundle-configured` downloads a configured multi-bundle using the current query parameters or default schema.
- `POST /downloads/waiter-bundle-configured` downloads a configured multi-bundle using the posted `schemaText` and `ostcId`.
- `GET /downloads/waiter-start-payload` downloads the example waiter start payload.
- `GET /downloads/chain-config` downloads the example XGR chain config.
- `GET /downloads/customer-api-doc` downloads this guide as markdown.
- `GET /xdala/ostc-hash` calculates the deployed OSTC hash from the XRC-729 contract or from the local bundle.
- `POST /xdala/check-waiter-schema` compares the configured AI result schema with the deployed XRC-137 rule used by the wait step.

### Live waiter APIs

- `GET /live/waiter` reads the current live waiter session for this `runtimeSessionId` and refreshes the waiting status with `xgr_listSessions`.
- `POST /live/start-waiter` starts a real waiter session with `xgr_validateDataTransfer`, then polls until the configured wait step is `WAITING`.
- `DELETE /live/waiter` clears the stored live waiter pointer for this tab/session.
- `GET /live/session-receipts` loads receipt data for the current waiter from the Explorer receipts API.
- `DELETE /live/demo-state` clears the current live waiter and uploaded document.
- `DELETE /live/demo-state/full` clears live waiter, uploaded document, and runtime config.

### Run APIs

- `GET /runs` lists demo runs kept in backend memory.
- `POST /runs` runs the document fetch, AI extraction, hash, wakeup, and final status flow.
- `GET /runs/:id` returns one run with steps and result.
- `GET /runs/:id/events` streams run updates as server-sent events.

## External APIs a customer must replace

### Document API

The demo expects a simple `GET` endpoint that returns the document bytes. If `documentApiKey` is set, the demo sends it as a bearer token.

```http
GET https://customer.example/api/document/123
Authorization: Bearer customer-token
```

The response can be text, JSON, HTML, PDF with embedded text, or another file type supported by the selected AI provider. For production, the customer should authenticate the caller and log the document source ID.

### AI provider APIs

The demo supports three modes:

- OpenAI Agents SDK with the selected OpenAI model.
- Google Gemini API with the selected Gemini model.
- Static mock mode for UI and blockchain tests without external AI.

The important rebuild point is the output schema. The AI result must match the configured JSON schema because the wakeup payload and XRC-137 validation are generated from the same fields.

### XGR JSON-RPC API

The demo calls XGR/XDaLa JSON-RPC with JSON-RPC 2.0 envelopes:

```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "method": "xgr_validateDataTransfer",
  "params": [{ "stepId": "ARM_WAIT", "payload": {}, "orchestration": "0x...", "permit": {} }]
}
```

The JSON-RPC wrapper is implemented in `src/xdala/rpcClient.js`.

### Explorer receipts API

The demo reads receipts with:

```http
GET {explorerUrl}/api/secure/receipts/bulk?sessionId={sessionId}&owner={owner}&limit=10000
```

This is implemented in `src/xdala/explorerClient.js`. A customer can replace this with its own receipt indexer or backend receipt API.

## XDaLa RPC functions used

### `xgr_getCoreAddrs`

Used by `src/xdala/startWaiterSession.js` to read chain metadata, the XDaLa precompile address, and the chain ID before permits are signed.

### `xgr_getNextProcessId`

Used by `src/xdala/startWaiterSession.js` to reserve or calculate the next session ID for the owner address before starting the waiter session.

Request shape used by the demo:

```json
{
  "from": "0xowner..."
}
```

### `xgr_validateDataTransfer`

Used by `src/xdala/startWaiterSession.js` to start the waiter session on the configured XRC-729 orchestration.

Important request fields:

- `stepId`: the configured start step, for example `ARM_WAIT`.
- `payload`: the waiter start payload.
- `orchestration`: deployed XRC-729 contract address.
- `permit`: EIP-712 `SessionPermit` signed by the owner key.

The waiter start payload contains the agent allowlist for the waiting step:

```json
{
  "RequestId": "demo-request-001",
  "WakeMarker": "initial",
  "__wakeUp": {
    "steps": {
      "WAIT_FOR_DOCUMENT": {
        "rpc": ["0xagent..."]
      }
    }
  }
}
```

### `xgr_listSessions`

Used by `src/xdala/pollSessionStatus.js` to poll the session until the wait step is `WAITING` and to read final rows after wakeup.

Request shape used by the demo:

```json
{
  "rootId": "1001",
  "last": 99999,
  "permit": { "primaryType": "xdalaPermit", "signature": "0x..." }
}
```

### `xgr_wakeUpProcess`

Used by `src/xdala/wakeupClient.js` after the AI has extracted data and the document hash exists.

Important request fields:

- `runner`: the owner/runner address of the existing session.
- `permit`: EIP-712 `ControlPermitV2` signed by the agent key.
- `stepId`: the waiting step, for example `WAIT_FOR_DOCUMENT`.
- `payload`: proof payload with document hash and extracted AI fields.

Example wakeup payload:

```json
{
  "RequestId": "demo-request-001",
  "WakeMarker": "woken-by-ai-agent",
  "DocumentName": "insurance-letter.txt",
  "DocumentHash": "0xsha256...",
  "HashAlgorithm": "sha256",
  "ProofCreatedAt": "2026-06-05T12:00:00.000Z",
  "ExtractedBy": "openai-agent",
  "InsuranceNumber": "KV-123456789",
  "DocumentDate": "2026-05-20",
  "DocumentType": "confirmation letter",
  "Confidence": 0.98,
  "Evidence": "Short visible evidence"
}
```

## Contract read functions used

### XRC-729 `getOSTC(string ostcId)`

Used by `src/xdala/ostcHash.js` and `src/xdala/waiterCompatibility.js`. The demo reads deployed OSTC JSON, canonicalizes it, and calculates the keccak hash used by the `SessionPermit`.

### XRC-137 `getRule()`

Used by `src/xdala/waiterCompatibility.js`. The demo reads the rule contract behind the waiting step and compares expected payload fields, XRC-137 types, and generated validation rules.

## EIP-712 permits

### `SessionPermit`

Signed by the owner key in `src/xdala/sessionPermit.js`.

Fields:

- `from`: owner address.
- `ostcId`: orchestration ID in XRC-729.
- `ostcHash`: deployed orchestration hash.
- `sessionId`: session ID from `xgr_getNextProcessId`.
- `maxTotalGas`: optional total gas limit.
- `expiry`: permit expiry timestamp.

### `ControlPermitV2`

Signed by the agent key in `src/xdala/controlPermit.js`.

Fields:

- `from`: agent address.
- `runner`: owner/runner address of the session.
- `sessionId`: waiter session ID.
- `action`: `wake`.
- `stepId`: wait step to wake.
- `expiry`: permit expiry timestamp.

### `xdalaPermit`

Signed by the owner key in `src/xdala/readPermit.js` for read access to `xgr_listSessions`.

Fields:

- `from`: owner address.
- `expiry`: permit expiry timestamp.

## End-to-end sequence

```text
Browser tab creates runtimeSessionId
Browser posts encrypted runtime config
Owner starts live waiter with xgr_validateDataTransfer
Backend polls xgr_listSessions until WAIT_FOR_DOCUMENT is WAITING
Browser starts run with POST /api/runs
Backend fetches document bytes
AI agent extracts schema-based fields
Backend hashes original document bytes with SHA-256
Agent signs ControlPermitV2
Backend calls xgr_wakeUpProcess
Backend reads final session rows and Explorer receipts
```

## Minimal customer rebuild checklist

- Keep the document fetch, AI extraction, and XDaLa calls in the backend.
- Scope runtime secrets by tenant, user, or browser tab. Do not use one global mutable secret store.
- Use one schema as the source for AI output, wakeup payload fields, and XRC-137 validation.
- Start the waiter before the AI wakeup run.
- Allowlist the agent address in the start payload for the exact wait step.
- Verify the XRC-729 OSTC hash after every bundle/schema deployment.
- Verify the deployed wait step with `POST /xdala/check-waiter-schema` before running a customer demo.
- Store only hashes and receipts when possible. Do not put full private documents on-chain.

## XGR documentation used

- [XGR Endpoint JSON-RPC reference](https://xgr.network/docs/xgr_endpoint/)
- [XDaLa permits](https://xgr.network/docs/xgr_permit/)
- [XRC-729 orchestration](https://xgr.network/docs/xrc729_orch/)
- [XRC-729 contract](https://xgr.network/docs/xrc729_contract/)
- [Manage Session UI docs](https://xgr.network/docs/ui_ops_manage_session/)
- [List Session UI docs](https://xgr.network/docs/ui_ops_list_session/)
