# XGR AI Agent Demo

A customer-ready demo application that shows how an AI Agent can read a business document, create a deterministic document proof, and wake a waiting XDaLa session on-chain.

The repository is meant to be downloaded, unpacked, configured, and run by a customer without needing code from `xDaLaWeb`.

## What the demo does

1. Starts or uses a waiting XDaLa waiter session.
2. Loads a document from an upload, manual text, customer API, or built-in sample.
3. Sends the document to an OpenAI or Gemini based extraction agent.
4. Validates the AI result against a JSON schema.
5. Hashes the original document bytes with SHA-256.
6. Builds a proof payload for XDaLa.
7. Signs the XDaLa wakeup permit in the backend.
8. Calls `xgr_wakeUpProcess`.
9. Shows the run timeline, proof payload, transaction result, and Explorer receipt proof in the web UI.

## Download options

### Option A: Download directly from GitHub

This option does not require GitHub Actions or GitHub billing.

1. Open this repository on GitHub.
2. Select the branch or tag you want to hand over.
3. Click **Code**.
4. Click **Download ZIP**.
5. Unzip the archive.
6. Follow [CUSTOMER_QUICKSTART.md](./CUSTOMER_QUICKSTART.md).

GitHub also exposes source archives for branches and tags automatically. This is the simplest customer handover path when the customer should receive the repository source as a ZIP.

### Option B: Create a curated customer ZIP locally

Use this when you want a ZIP with only the selected customer package files:

```bash
npm run package:customer
```

The ZIP is written to:

```text
dist-package/xgr-agent-customer-demo.zip
```

The package intentionally excludes local runtime files, build output, installed dependencies, and private configuration.

### Option C: Clone the repository

```bash
git clone <repository-url>
cd xgr_Agent
```

Use this when the customer should also receive Git history.

## Quick start: mock mode

Mock mode works without blockchain keys and without AI API keys. It is the fastest way to verify that the package runs.

### Docker

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
http://localhost:3020
```

`.env.secrets` is optional. Docker Compose loads it automatically when it exists, but the mock demo does not need it.

### Local Node.js

Requirements: Node.js 20 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL printed by the terminal, usually:

```text
http://localhost:5173
```

## Live mode overview

Live mode connects the demo to a real XDaLa network and wakes a real waiting session.

The customer must provide:

- XDaLa RPC URL and chain selection.
- Deployed XRC-729 waiter/orchestration address.
- OSTC ID and on-chain OSTC hash.
- Owner wallet key for starting/read access.
- Agent wallet key for the wakeup permit.
- OpenAI or Gemini API key, unless mock extraction is acceptable.
- Optional customer document API URL and bearer token.

The web UI contains a **Live XDaLa setup** panel that guides the customer through these steps.

## Live mode steps

1. Start the app.
2. Open the **Live XDaLa setup** panel.
3. Download the configured waiter bundle or use:

   ```text
   demo/xdala/document-agent-waiter.multi-bundle.json
   ```

4. Deploy the waiter bundle in xDaLaWeb.
5. Copy the deployed XRC-729 address into the setup panel.
6. Calculate or paste the OSTC hash.
7. Select OpenAI or Gemini and provide the API key.
8. Enter owner and agent wallet keys.
9. Store and unlock the runtime configuration.
10. Start the live waiter session.
11. Run the AI wakeup.
12. Inspect the timeline, wakeup payload, transaction result, and Explorer receipts.

## Configuration files

Start from the template:

```bash
cp .env.example .env
```

Important public/default values:

```bash
DEMO_MODE=mock
PORT=3020
AI_PROVIDER=openai
OPENAI_MODEL=gpt-4.1-mini
GEMINI_MODEL=gemini-3.5-flash
XDALA_RPC_URL=https://rpc1.testnet.xgr.network/
XDALA_OSTC_ID=document_agent_waiter_flow
XDALA_START_STEP_ID=ARM_WAIT
XDALA_WAIT_STEP_ID=WAIT_FOR_DOCUMENT
```

For live use, secrets can be entered through the UI runtime vault or stored in an encrypted `.env.secrets` file. Do not commit customer keys or local `.env` files.

## Encrypted `.env.secrets` setup

Use this when the customer wants the backend to load secrets from a local encrypted file instead of pasting them into the UI after each restart.

First create the local customer secrets file:

```bash
npm run secrets:init
```

This creates:

```text
.secrets/customer.local.json
```

Edit that file locally and fill in the required keys:

```json
{
  "openai": { "apiKey": "" },
  "gemini": { "apiKey": "" },
  "document": { "apiKey": "" },
  "xdala": {
    "ownerPrivateKey": "",
    "agentPrivateKey": ""
  }
}
```

Then create the encrypted env file:

```bash
npm run secrets:encrypt -- .secrets/customer.local.json --out .env.secrets
```

The command asks for an encryption password and writes:

```text
.env.secrets
```

Docker Compose loads `.env.secrets` automatically when it exists. If it does not exist, the app still starts in mock mode.

For non-interactive environments, provide the encryption password with:

```bash
XGR_AGENT_SECRET_PASSWORD='change-me' npm run secrets:encrypt -- .secrets/customer.local.json --out .env.secrets
```

Important: `.secrets/`, `.env`, and `.env.secrets` are local runtime files. They must not be committed or sent to customers with real keys.

## Included XDaLa integration logic

The repository intentionally contains the public XDaLa integration logic directly, so customers can copy and adapt it:

```text
src/xdala/rpcClient.js             JSON-RPC calls
src/xdala/sessionPermit.js         SessionPermit signing
src/xdala/controlPermit.js         ControlPermitV2 signing
src/xdala/startWaiterSession.js    Starts waiter sessions
src/xdala/wakeupClient.js          Calls xgr_wakeUpProcess
src/xdala/pollSessionStatus.js     Reads and waits for session rows
src/xdala/explorerClient.js        Fetches Explorer receipts
src/xdala/sessionReceiptReport.js  Builds receipt reports
```

Implemented RPC methods include:

- `xgr_getCoreAddrs`
- `xgr_getNextProcessId`
- `xgr_validateDataTransfer`
- `xgr_wakeUpProcess`
- `xgr_listSessions`

## Important application files

```text
src/server/server.js               Express server and static app hosting
src/server/routes/demoRoutes.js    API routes for config, live waiter, runs, downloads
src/server/demoRunner.js           Main demo orchestration
src/agent/documentAgent.js         Provider switch and OpenAI Agent implementation
src/agent/geminiDocumentAgent.js   Gemini implementation
src/agent/documentExtractionSchema.js Dynamic result schema handling
src/document/fetchDocument.js      Document source selection
src/document/hashDocument.js       Deterministic SHA-256 hash
src/document/buildWakeupPayload.js Builds XDaLa wakeup proof payload
src/web/src/App.jsx                Main React demo UI
```

## Waiter bundle

The default waiter bundle is:

```text
demo/xdala/document-agent-waiter.multi-bundle.json
```

It contains this simple flow:

```text
ARM_WAIT -> WAIT_FOR_DOCUMENT -> DONE
```

`WAIT_FOR_DOCUMENT` is the step woken by the backend through `xgr_wakeUpProcess`.

The waiter session must allow the backend agent wallet for RPC wakeup:

```json
{
  "__wakeUp": {
    "steps": {
      "WAIT_FOR_DOCUMENT": {
        "rpc": ["0xAgentAddress"]
      }
    }
  }
}
```

The backend creates this start payload automatically in live mode.

## AI Agent

The AI Agent is created in code. Customers do not need to create a separate assistant in a dashboard.

Provider files:

```text
src/agent/documentAgent.js
src/agent/geminiDocumentAgent.js
src/agent/documentAgentInstructions.js
src/agent/documentExtractionSchema.js
```

Default structured output:

```json
{
  "insuranceNumber": "...",
  "documentDate": "YYYY-MM-DD",
  "documentType": "insurance_confirmation",
  "confidence": 0.95,
  "evidence": "short reference"
}
```

Customers can change the extraction instructions and JSON schema in the live setup panel.

## Explorer receipt proof

After a live run, the app can fetch receipt data from the configured Explorer:

```http
GET /api/live/session-receipts
```

The backend calls:

```http
GET {explorerUrl}/api/secure/receipts/bulk?sessionId={sessionId}&owner={owner}&includeTx=true&includeBlock=true&limit=10000
```

The UI displays receipt cards and the raw decoded JSON response.

## Security model

- Private keys stay in the backend process.
- Private keys are never sent to the AI model.
- API keys and signer keys should not be committed.
- The AI model receives only the document content and extraction instructions.
- The backend hashes the original document bytes deterministically.
- The backend signs XDaLa permits.
- For production, replace demo runtime storage with a customer-controlled KMS, HSM, Vault, or signing service.

## Production hardening checklist

- Add authentication in front of the backend.
- Replace local keys with managed signing.
- Add persistent run/audit storage.
- Add rate limiting.
- Add customer-specific document schemas.
- Add a production document ingestion service.
- Store hashes instead of raw sensitive IDs where possible.
- Configure proper TLS and reverse proxy headers.

## More documentation

- [Customer quickstart](./CUSTOMER_QUICKSTART.md)
- [Waiter bundle documentation](./demo/xdala/README.md)
- In-app customer API guide: `/docs/customer-api`
