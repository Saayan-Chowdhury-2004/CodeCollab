import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Fails when the repo contains something that looks like a committed credential.
// Findings print file:line and the rule name only, never the matched value.

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.codebase-memory']);
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|sql|env|example|txt|html|css|conf|toml|sh|ps1)$/i;
const SELF = path.join('scripts', 'check-no-secrets.mjs');

const RULES = [
  {
    name: 'GitHub client secret (40 hex chars next to a *SECRET key)',
    regex: /[A-Z_]*SECRET[A-Z_]*["']?\s*[:=]\s*["']?[0-9a-f]{40}\b/i,
  },
  {
    name: 'Non-empty default for a *SECRET variable in compose syntax',
    regex: /\$\{[A-Z_]*SECRET[A-Z_]*:-[^}]+\}/,
  },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Private key block', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
];

function listFiles() {
  try {
    const out = execSync('git ls-files', { cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    if (out.length > 0) return { files: out, viaGit: true };
  } catch {
    // not a git checkout; fall through to a directory walk
  }
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else {
        files.push(path.relative(rootDir, path.join(dir, entry.name)));
      }
    }
  })(rootDir);
  return { files, viaGit: false };
}

const { files, viaGit } = listFiles();
const findings = [];

for (const rel of files) {
  const base = path.basename(rel);
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => SKIP_DIRS.has(p))) continue;

  // A tracked .env file (anything except *.example) must never be committed.
  if (viaGit && /^\.env(\..+)?$/.test(base) && !base.endsWith('.example')) {
    findings.push(`${rel}: tracked env file`);
    continue;
  }

  if (rel === SELF) continue;
  if (!TEXT_EXT.test(base) && !/^\.env/.test(base)) continue;

  const full = path.join(rootDir, rel);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 1_000_000) continue;
  // Untracked local .env files are ignored by git and legitimately hold secrets.
  if (!viaGit && /^\.env(\..+)?$/.test(base) && !base.endsWith('.example')) continue;

  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.regex.test(line)) {
        findings.push(`${rel}:${i + 1}: ${rule.name}`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error('Possible committed secrets found (values are not printed):');
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`✓ No committed secrets found (${files.length} files scanned${viaGit ? ', tracked files only' : ''}).`);
