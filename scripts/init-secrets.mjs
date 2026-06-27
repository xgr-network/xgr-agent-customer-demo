#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { encryptJson, encodeEncryptedSecretBundle, requireSecretPassword } from '../src/server/secrets/secretCrypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const secretsDir = path.join(rootDir, '.secrets');
const sourceFile = path.join(rootDir, 'demo', 'secrets.example.json');
const targetFile = path.join(secretsDir, 'customer.local.json');
const encryptedEnvFile = path.join(rootDir, '.env.secrets');

function relative(filePath) {
  return path.relative(rootDir, filePath).replaceAll(path.sep, '/');
}

function readArgFlag(name) {
  return process.argv.includes(name);
}

function ensureSourceExists() {
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`${relative(sourceFile)} is missing. Apply the encrypted secrets patch first.`);
  }
}

function ensureSecretsDirectory() {
  fs.mkdirSync(secretsDir, { recursive: true });
}

function ensureCustomerSecretsFile() {
  if (fs.existsSync(targetFile)) {
    console.log(`${relative(targetFile)} already exists. It was not overwritten.`);
    return false;
  }

  fs.copyFileSync(sourceFile, targetFile);
  console.log(`Created ${relative(targetFile)} from ${relative(sourceFile)}.`);
  return true;
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

function hasAnySecret(bundle) {
  return Object.values(buildPublicMeta(bundle)).some(Boolean);
}

function readCustomerSecrets() {
  return normalizeSecretBundle(JSON.parse(fs.readFileSync(targetFile, 'utf8')));
}

function readPassword(promptText) {
  return new Promise((resolve, reject) => {
    if (process.env.XGR_AGENT_SECRET_PASSWORD) {
      resolve(process.env.XGR_AGENT_SECRET_PASSWORD);
      return;
    }

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

async function writeEncryptedEnvSecrets(bundle) {
  const password = requireSecretPassword(await readPassword('Encryption password for .env.secrets: '));
  const encrypted = encryptJson(bundle, password, {
    purpose: 'xgr-agent-env-secrets',
    publicMeta: buildPublicMeta(bundle),
  });
  const output = `XGR_AGENT_ENCRYPTED_SECRETS=${encodeEncryptedSecretBundle(encrypted)}\n`;
  fs.writeFileSync(encryptedEnvFile, output, 'utf8');
  console.log(`Wrote encrypted secrets to ${relative(encryptedEnvFile)}.`);
}

function printNextSteps(createdCustomerFile, hasSecrets) {
  if (createdCustomerFile || !hasSecrets) {
    console.log('');
    console.log('Next step: edit the local customer secrets file:');
    console.log(`  ${relative(targetFile)}`);
    console.log('');
    console.log('Then run this command again to create .env.secrets:');
    console.log('  npm run secrets:init');
    return;
  }

  console.log('');
  console.log('Docker will load .env.secrets through docker-compose.yml.');
  console.log('Restart the demo after changing .env.secrets:');
  console.log('  docker compose down');
  console.log('  docker compose up -d --force-recreate');
}

async function main() {
  ensureSourceExists();
  ensureSecretsDirectory();
  const createdCustomerFile = ensureCustomerSecretsFile();
  const bundle = readCustomerSecrets();
  const hasSecrets = hasAnySecret(bundle);

  if (hasSecrets && (!fs.existsSync(encryptedEnvFile) || readArgFlag('--force') || !createdCustomerFile)) {
    await writeEncryptedEnvSecrets(bundle);
  }

  printNextSteps(createdCustomerFile, hasSecrets);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
