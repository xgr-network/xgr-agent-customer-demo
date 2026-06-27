# Customer quickstart

This guide is for customers who downloaded the repository ZIP from GitHub or received a curated `xgr-agent-customer-demo.zip` package created with `npm run package:customer`.

## 1. Unpack the package

If you used GitHub **Code > Download ZIP**, the unpacked folder name usually includes the repository and branch name, for example:

```text
xgr_Agent-main
```

If you received the curated customer package, unpack it with:

```bash
unzip xgr-agent-customer-demo.zip
cd xgr-agent-customer-demo
```

Then open a terminal in the unpacked folder.

## 2. Run the demo without blockchain keys

The default mode is mock mode. It proves that the app, UI, document flow, and proof payload generation work.

### Docker

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
http://localhost:3020
```

### Local Node.js

```bash
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL printed by the terminal, usually:

```text
http://localhost:5173
```

## 3. What to check in mock mode

Click the run button in the UI and verify:

- The document is loaded from the built-in sample.
- The AI extraction step completes.
- The original document bytes are hashed.
- A wakeup payload is created.
- The mocked XDaLa wakeup result is shown.

No XDaLa key, AI API key, or customer API is required for this mode.

## 4. Prepare live mode

For a real live run, you need:

| Item | Purpose |
| --- | --- |
| XDaLa RPC URL | Blockchain JSON-RPC endpoint |
| Explorer URL | Receipt proof lookup |
| XRC-729 address | Deployed waiter/orchestration contract |
| OSTC ID and OSTC hash | Identifies the deployed waiter flow |
| Owner wallet key | Starts/reads the waiter session |
| Agent wallet key | Signs the wakeup permit |
| OpenAI or Gemini key | Runs the extraction agent |
| Optional document API URL/key | Loads customer documents |

## 5. Deploy the waiter bundle

Use the default bundle:

```text
demo/xdala/document-agent-waiter.multi-bundle.json
```

Deploy it in xDaLaWeb on the selected network, then copy the deployed XRC-729 address into the live setup panel.

The default flow is:

```text
ARM_WAIT -> WAIT_FOR_DOCUMENT -> DONE
```

The backend starts the waiter session and grants the agent wallet permission to wake `WAIT_FOR_DOCUMENT`.

## 6. Configure live mode in the UI

1. Open the app.
2. Open **Live XDaLa setup and AI Agent credentials**.
3. Select Testnet, or Mainnet.
4. Paste the deployed XRC-729 address.
5. Calculate or paste the OSTC hash.
6. Choose OpenAI or Gemini.
7. Enter the AI API key.
8. Enter the owner and agent wallet keys.
9. Enter a runtime password.
10. Store/unlock the runtime configuration.
11. Start the live waiter.
12. Run the AI wakeup.

## 7. Verify the live result

After the run, check:

- Timeline status in the UI.
- Extracted business data.
- `DocumentHash` in the wakeup payload.
- XDaLa wakeup result.
- Explorer receipt cards.
- Raw receipt JSON.

## 8. Use a customer document API

The UI can load a document from an HTTP endpoint.

Configure:

```text
Document API URL
Document API key, optional bearer token
```

The backend fetches the document bytes, sends the document to the selected AI provider, and hashes the original bytes for the proof.

## 9. Security notes for customer handover

- Do not commit `.env` files.
- Do not commit API keys or wallet keys.
- Use the runtime setup panel or encrypted secret tooling for demos.
- Replace demo runtime storage with KMS, HSM, Vault, or a signing service for production.
- The AI model must never receive wallet keys, API keys, or runtime passwords.

## 10. Common commands

```bash
npm run dev                 # local development
npm run build               # build frontend
npm start                   # run production server after build
npm run package:customer    # create curated customer ZIP package locally
```

## 11. Troubleshooting

### The page does not open on port 3000

This demo uses port `3020` in Docker by default. Open:

```text
http://localhost:3020
```

### Live run is disabled

Start the live waiter first. The live run button is enabled only after the configured wait step is waiting.

### OSTC hash mismatch

Recalculate the OSTC hash against the deployed XRC-729 address and selected network.

### AI extraction fails

Check that the selected provider key is unlocked and that the selected model name is valid for the provider.
