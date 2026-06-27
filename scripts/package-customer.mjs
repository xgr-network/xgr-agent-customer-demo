import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, 'dist-package');
const packageName = process.env.XGR_AGENT_PACKAGE_NAME || 'xgr-agent-customer-demo';
const outputFile = path.join(outputDir, `${packageName}.zip`);

const includePaths = [
  'README.md',
  'CUSTOMER_QUICKSTART.md',
  '.env.example',
  'package.json',
  'package-lock.json',
  'Dockerfile',
  'docker-compose.yml',
  'src',
  'demo',
  'scripts',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function assertGitAvailable() {
  const result = spawnSync('git', ['--version'], {
    cwd: rootDir,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error('git is required to create the customer ZIP package.');
  }
}

fs.mkdirSync(outputDir, { recursive: true });
if (fs.existsSync(outputFile)) fs.rmSync(outputFile);

assertGitAvailable();

run('git', [
  'archive',
  '--format=zip',
  `--output=${outputFile}`,
  `--prefix=${packageName}/`,
  'HEAD',
  ...includePaths,
]);

const stat = fs.statSync(outputFile);
console.log(`Created ${path.relative(rootDir, outputFile)} (${stat.size} bytes).`);
console.log('The package contains only selected tracked project files and excludes local runtime files.');
