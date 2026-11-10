import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function parseEnvKeys(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const keys = new Set();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=/);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

function extractBackendSchemaKeys() {
  const envTsPath = path.join(rootDir, 'backend', 'src', 'config', 'env.ts');
  const content = fs.readFileSync(envTsPath, 'utf8');
  const schemaMatch = content.match(/const envSchema = z\.object\(\{([\s\S]*?)\}\);/);
  if (!schemaMatch) {
    throw new Error('Could not find envSchema in backend/src/config/env.ts');
  }
  const schemaBody = schemaMatch[1];
  const keys = new Set();
  for (const line of schemaBody.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    const keyMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:/);
    if (keyMatch) {
      keys.add(keyMatch[1]);
    }
  }
  return keys;
}

function extractFrontendEnvKeys() {
  const frontendSrc = path.join(rootDir, 'frontend', 'src');
  const keys = new Set();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const text = fs.readFileSync(fullPath, 'utf8');
        const matches = text.matchAll(/import\.meta\.env\.(VITE_[A-Za-z0-9_]+)/g);
        for (const m of matches) {
          keys.add(m[1]);
        }
      }
    }
  }
  walk(frontendSrc);
  return keys;
}

function extractComposeKeys() {
  const composePath = path.join(rootDir, 'docker-compose.yml');
  const content = fs.readFileSync(composePath, 'utf8');
  const keys = new Set();
  const matches = content.matchAll(/\$\{([A-Za-z0-9_]+)(?::[^}]*)?\}/g);
  for (const m of matches) {
    keys.add(m[1]);
  }
  return keys;
}

let hasError = false;

// 1. Backend check
console.log('--- Checking backend .env.example parity ---');
const backendSchemaKeys = extractBackendSchemaKeys();
const backendExampleKeys = parseEnvKeys(path.join(rootDir, 'backend', '.env.example'));

const missingInBackend = [...backendSchemaKeys].filter((k) => !backendExampleKeys.has(k));
if (missingInBackend.length > 0) {
  console.error('ERROR: Missing in backend/.env.example:', missingInBackend);
  hasError = true;
} else {
  console.log(`✓ All ${backendSchemaKeys.size} backend schema variables present in backend/.env.example`);
}

// 2. Frontend check
console.log('\n--- Checking frontend .env.example parity ---');
const frontendCodeKeys = extractFrontendEnvKeys();
const frontendExampleKeys = parseEnvKeys(path.join(rootDir, 'frontend', '.env.example'));

const missingInFrontend = [...frontendCodeKeys].filter((k) => !frontendExampleKeys.has(k));
if (missingInFrontend.length > 0) {
  console.error('ERROR: Missing in frontend/.env.example:', missingInFrontend);
  hasError = true;
} else {
  console.log(`✓ All ${frontendCodeKeys.size} frontend variables present in frontend/.env.example`);
}

// 3. Root compose check
console.log('\n--- Checking root .env.example compose parity ---');
const composeKeys = extractComposeKeys();
const rootExampleKeys = parseEnvKeys(path.join(rootDir, '.env.example'));

const missingInRoot = [...composeKeys].filter((k) => !rootExampleKeys.has(k));
if (missingInRoot.length > 0) {
  console.error('ERROR: Missing in root .env.example:', missingInRoot);
  hasError = true;
} else {
  console.log(`✓ All ${composeKeys.size} docker-compose variables present in root .env.example`);
}

if (hasError) {
  process.exit(1);
} else {
  console.log('\n✓ Env example check passed successfully.');
}

