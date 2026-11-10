import fs from 'fs';
import path from 'path';

const distDir = path.resolve('frontend/dist');
if (!fs.existsSync(distDir)) {
  console.error('[ERROR] frontend/dist directory does not exist. Run build first.');
  process.exit(1);
}

const FORBIDDEN_STRINGS = [
  'AdminPass123',
  'EditorPass123',
  'ViewerPass123',
  'admin@codecollab.dev',
];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const forbidden of FORBIDDEN_STRINGS) {
    if (content.includes(forbidden)) {
      console.error(`[SECURITY_FAIL] Found forbidden demo credential "${forbidden}" in built asset: ${filePath}`);
      process.exit(1);
    }
  }
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (/\.(js|html|css|json)$/.test(entry.name)) {
      checkFile(fullPath);
    }
  }
}

walkDir(distDir);
console.log('✓ Verified: No demo credentials present in frontend/dist production bundle.');

