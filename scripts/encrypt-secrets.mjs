#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { encryptJson, encodeEncryptedSecretBundle, requireSecretPassword } from '../src/server/secrets/secretCrypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function printUsage() {
  console.log(`Usage:
  npm run secrets:encrypt -- demo/secrets.example.json
  npm run secrets:encrypt -- .secrets/customer.local.json --out .env.secrets

Input JSON shape:
{
  "openai": { "apiKey": "..." },
  "gemini": { "apiKey": "..." },
  "document": { "apiKey": "..." },
  "xdala": {
    "ownerPrivateKey": "...",
    "agentPrivateKey": "..."
  }
}

The command prints:
  XGR_AGENT_ENCRYPTED_SECRETS=...

The password is used only for encryption and is not written to the output.`);
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return String(process.argv[index + 1] || '').trim();
}

function firstInputPath() {
  return process.argv.slice(2).find((item) => !item.startsWith('--')) || '';
}

function readPassword(promptText) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let password = '';

    if (!stdin.isTTY) {
      reject(new Error('Interactive password input requires a TTY. Set XGR_AGENT_SECRET_PASSWORD for non-interactive use.'));
      return;
    }

    stdout.write(promptText);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    }

    function onData(char) {
      if (char === '\u0003') {
        cleanup();
        reject(new Error('Aborted.'));
        return;
      }
      if (char === '\r' || char === '\n') {
        cleanup();
        resolve(password);
        return;
      }
      if (char === '\u007f') {
        password = password.slice(0, -1);
        stdout.write('\b \b');
        return;
      }
      password += char;
      stdout.write('*');
    }

    stdin.on('data', onData);
  });
}

function normalizeSecretBundle(input) {
  const bundle = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    openai: {
      apiKey: String(bundle.openai?.apiKey || '').trim(),
    },
    gemini: {
      apiKey: String(bundle.gemini?.apiKey || '').trim(),
    },
    document: {
      apiKey: String(bundle.document?.apiKey || '').trim(),
    },
    xdala: {
      ownerPrivateKey: String(bundle.xdala?.ownerPrivateKey || '').trim(),
      agentPrivateKey: String(bundle.xdala?.agentPrivateKey || '').trim(),
    },
  };
}

function buildPublicMeta(bundle) {
  return {
    hasOpenAiApiKey: !!bundle.openai.apiKey,
    hasGeminiApiKey: !!bundle.gemini.apiKey,
    hasDocumentApiKey: !!bundle.document.apiKey,
    hasXdalaOwnerPrivateKey: !!bundle.xdala.ownerPrivateKey,
    hasXdalaAgentPrivateKey: !!bundle.xdala.agentPrivateKey,
  };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const inputPath = firstInputPath();
  if (!inputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const absoluteInputPath = path.resolve(rootDir, inputPath);
  const raw = fs.readFileSync(absoluteInputPath, 'utf8');
  const bundle = normalizeSecretBundle(JSON.parse(raw));
  const password = requireSecretPassword(
    process.env.XGR_AGENT_SECRET_PASSWORD || await readPassword('Encryption password: ')
  );
  const encrypted = encryptJson(bundle, password, {
    purpose: 'xgr-agent-env-secrets',
    publicMeta: buildPublicMeta(bundle),
  });
  const output = `XGR_AGENT_ENCRYPTED_SECRETS=${encodeEncryptedSecretBundle(encrypted)}\n`;

  const outPath = readArgValue('--out');
  if (outPath) {
    fs.writeFileSync(path.resolve(rootDir, outPath), output, 'utf8');
    console.log(`Wrote encrypted secrets to ${outPath}`);
    return;
  }

  process.stdout.write(output);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
