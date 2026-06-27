# XDaLa waiter bundle for the document agent demo

This folder contains the live waiter bundle for the `xgr_Agent` customer demo.

The structure follows the same idea as the wakeup scenario examples in `xDaLaWeb`:

1. Start a waiter session.
2. Move into a waiting step.
3. Let an external actor wake that step.
4. Continue the session after the wakeup payload is accepted.

## Files

```text
document-agent-waiter.multi-bundle.json   Import/deploy this in xDaLaWeb
waiter-start-payload.example.json         Example start payload with the RPC wakeup allowlist
```

## Flow

```text
ARM_WAIT
  -> WAIT_FOR_DOCUMENT
  -> DONE
```

`WAIT_FOR_DOCUMENT` is the step that the AI Agent wakes by calling `xgr_wakeUpProcess`.

The document proof fields on `WAIT_FOR_DOCUMENT` intentionally have safe defaults. This is required because XRC-729 spawn coverage validates the payload shape before the wakeup happens. The real proof values are still provided later by the agent wakeup payload.

## Required runtime values

After importing and deploying the bundle in xDaLaWeb, copy the values into `.env`:

```bash
XDALA_ORCHESTRATION_ADDRESS=<deployed XRC-729 address>
XDALA_OSTC_ID=document_agent_waiter_flow
XDALA_START_STEP_ID=ARM_WAIT
XDALA_WAIT_STEP_ID=WAIT_FOR_DOCUMENT
```

`XDALA_OSTC_HASH` can stay the default zero hash for this demo unless your deployment/export gives you a specific hash.

## Wakeup allowlist

The waiter session start payload must allow the agent wallet for RPC wakeup:

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

The backend creates this automatically in `src/xdala/startWaiterSession.js` from `XDALA_AGENT_PRIVATE_KEY`.

## Expected wakeup payload

The AI Agent sends a deterministic proof payload similar to this:

```json
{
  "RequestId": "demo-request-001",
  "WakeMarker": "woken-by-ai-agent",
  "DocumentName": "sample-insurance-letter.txt",
  "DocumentDate": "2026-05-20",
  "DocumentHash": "0x...",
  "HashAlgorithm": "sha256",
  "InsuranceNumber": "KV-123456789",
  "DocumentType": "insurance_confirmation",
  "Confidence": 0.96,
  "ProofCreatedAt": "2026-05-29T12:00:00.000Z"
}
```

## Chain config

`xgr-chain-config.example.json` contains the Devnet, Testnet, and Mainnet chain values used by the website live setup panel. The values mirror the xDaLaWeb chain service so customers can copy the config into their own agent implementation.
