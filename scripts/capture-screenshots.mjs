import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { Server as SocketServer } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(ROOT_DIR, 'frontend/dist');
const SCREENSHOTS_DIR = path.resolve(ROOT_DIR, 'screenshots');
const ARTIFACT_SCREENSHOTS_DIR = 'C:\\Users\\Saayan Chowdhury\\.gemini\\antigravity\\brain\\66ed2156-26a5-4cbd-848e-dd4217da54d3\\screenshots';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}
if (!fs.existsSync(ARTIFACT_SCREENSHOTS_DIR)) {
  fs.mkdirSync(ARTIFACT_SCREENSHOTS_DIR, { recursive: true });
}

const SNIPPET_ID = '11111111-2222-3333-4444-555555555555';

const SAMPLE_CONTENT = `import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// Initialize collaborative document
export class CollaborativeDoc {
  private doc: Y.Doc;
  private text: Y.Text;

  constructor(roomName: string) {
    this.doc = new Y.Doc();
    this.text = this.doc.getText('monaco');
  }

  public insert(index: number, content: string): void {
    this.text.insert(index, content);
  }

  public toString(): string {
    return this.text.toString();
  }
}`;

const SAMPLE_SNIPPET = {
  id: SNIPPET_ID,
  title: 'CRDT Collaborative Document Buffer',
  description: 'Production-ready Yjs CRDT binding with Monaco editor real-time awareness and multi-cursor sync.',
  language: 'typescript',
  visibility: 'public',
  currentContent: SAMPLE_CONTENT,
  latestVersionNumber: 3,
  ownerId: 'u-admin',
  owner: {
    id: 'u-admin',
    username: 'admin_alex',
    displayName: 'Alex Rivera',
    avatarUrl: null,
  },
  collaborators: [
    {
      userId: 'u-elena',
      role: 'editor',
      user: {
        id: 'u-elena',
        username: 'elena_dev',
        displayName: 'Elena Rostova',
      },
    },
    {
      userId: 'u-victor',
      role: 'viewer',
      user: {
        id: 'u-victor',
        username: 'victor_read',
        displayName: 'Victor Vance',
      },
    },
  ],
  tags: ['algorithms', 'crdt', 'realtime', 'collaboration'],
  createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  updatedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
  headline: null,
  rank: 1,
  effectiveRole: 'owner',
};

const SAMPLE_COMMENTS = [
  {
    id: 'c-1',
    snippetId: SNIPPET_ID,
    lineNumber: 5,
    authorId: 'u-elena',
    author: {
      id: 'u-elena',
      username: 'elena_dev',
      displayName: 'Elena Rostova',
      avatarUrl: null,
    },
    body: 'Should we export this class as a singleton or allow multiple room instances per session?',
    resolved: false,
    resolvedAt: null,
    resolvedById: null,
    isOutdated: false,
    anchorLineText: 'export class CollaborativeDoc {',
    currentLineText: 'export class CollaborativeDoc {',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    replies: [
      {
        id: 'c-1-r1',
        snippetId: SNIPPET_ID,
        parentId: 'c-1',
        lineNumber: 5,
        authorId: 'u-admin',
        author: {
          id: 'u-admin',
          username: 'admin_alex',
          displayName: 'Alex Rivera',
          avatarUrl: null,
        },
        body: 'Allowing multiple instances is cleaner for multi-tab snippet comparisons.',
        resolved: false,
        resolvedAt: null,
        resolvedById: null,
        isOutdated: false,
        anchorLineText: null,
        currentLineText: null,
        createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        replies: [],
      },
    ],
  },
  {
    id: 'c-2',
    snippetId: SNIPPET_ID,
    lineNumber: 10,
    authorId: 'u-victor',
    author: {
      id: 'u-victor',
      username: 'victor_read',
      displayName: 'Victor Vance',
      avatarUrl: null,
    },
    body: 'Notice: the constructor parameter was changed in the recent version update.',
    resolved: false,
    resolvedAt: null,
    resolvedById: null,
    isOutdated: true,
    anchorLineText: 'constructor(room: string, opts?: Options) {',
    currentLineText: 'constructor(roomName: string) {',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    replies: [],
  },
];

// Content types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

let currentSimulatedMode = 'signed-in'; // 'signed-in' | 'signed-out' | 'read-only' | 'empty'

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Endpoints
  if (pathname === '/api/auth/me') {
    if (currentSimulatedMode === 'signed-out') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }
    const role = currentSimulatedMode === 'read-only' ? 'viewer' : 'admin';
    const user = {
      id: currentSimulatedMode === 'read-only' ? 'u-victor' : 'u-admin',
      username: currentSimulatedMode === 'read-only' ? 'victor_read' : 'admin_alex',
      displayName: currentSimulatedMode === 'read-only' ? 'Victor Vance' : 'Alex Rivera',
      email: currentSimulatedMode === 'read-only' ? 'victor@codecollab.dev' : 'admin@codecollab.dev',
      globalRole: role,
      avatarUrl: null,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, user }));
    return;
  }

  if (pathname === '/api/snippets/facets') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        facets: {
          languages: [
            { language: 'typescript', count: 8 },
            { language: 'python', count: 4 },
            { language: 'rust', count: 2 },
          ],
          tags: [
            { name: 'crdt', count: 4 },
            { name: 'realtime', count: 3 },
            { name: 'algorithms', count: 3 },
          ],
        },
      })
    );
    return;
  }

  if (pathname === '/api/snippets') {
    if (currentSimulatedMode === 'empty') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, items: [], nextCursor: null, hasMore: false }));
      return;
    }
    const snippetForList = {
      ...SAMPLE_SNIPPET,
      effectiveRole: currentSimulatedMode === 'read-only' ? 'viewer' : currentSimulatedMode === 'signed-out' ? 'anonymous_viewer' : 'owner',
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        items: [snippetForList],
        nextCursor: null,
        hasMore: false,
      })
    );
    return;
  }

  if (pathname === `/api/snippets/${SNIPPET_ID}`) {
    if (currentSimulatedMode === 'empty') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Snippet not found' }));
      return;
    }
    const effectiveRole =
      currentSimulatedMode === 'read-only'
        ? 'viewer'
        : currentSimulatedMode === 'signed-out'
        ? 'anonymous_viewer'
        : 'owner';

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, snippet: { ...SAMPLE_SNIPPET, effectiveRole } }));
    return;
  }

  if (pathname === `/api/snippets/${SNIPPET_ID}/comments`) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, comments: SAMPLE_COMMENTS }));
    return;
  }

  if (pathname === `/api/snippets/${SNIPPET_ID}/activities` || pathname === '/api/activities/global') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, items: [], nextCursor: null, hasMore: false }));
    return;
  }

  if (pathname === '/api/notifications') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, items: [], unreadCount: 0, nextCursor: null, hasMore: false }));
    return;
  }

  // Serve static files
  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    // SPA fallback
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  if (ext === '.html') {
    let html = fs.readFileSync(filePath, 'utf8');
    // Inject mock session storage setup
    const token =
      currentSimulatedMode === 'signed-out'
        ? ''
        : currentSimulatedMode === 'read-only'
        ? 'token-viewer'
        : 'token-editor';
    const injection = `
      <script>
        if ("${token}") {
          sessionStorage.setItem('access_token', '${token}');
        } else {
          sessionStorage.removeItem('access_token');
        }
      </script>
    `;
    html = html.replace('<head>', `<head>${injection}`);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(html);
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// Attach Socket.io
const io = new SocketServer(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  socket.on('room:join', ({ snippetId }) => {
    socket.join(`snippet:${snippetId}`);
    const role =
      currentSimulatedMode === 'read-only'
        ? 'viewer'
        : currentSimulatedMode === 'signed-out'
        ? 'anonymous_viewer'
        : 'owner';

    socket.emit('yjs:init', {
      snippetId,
      state: '',
      content: SAMPLE_CONTENT,
      versionId: 'v3',
      latestVersionNumber: 3,
      role,
      members: [
        {
          socketId: socket.id,
          userId: currentSimulatedMode === 'read-only' ? 'u-victor' : 'u-admin',
          username: currentSimulatedMode === 'read-only' ? 'victor_read' : 'admin_alex',
          displayName: currentSimulatedMode === 'read-only' ? 'Victor Vance' : 'Alex Rivera',
          role,
          color: '#6366f1',
        },
        {
          socketId: 'peer-elena',
          userId: 'u-elena',
          username: 'elena_dev',
          displayName: 'Elena Rostova',
          role: 'editor',
          color: '#10b981',
          cursor: { lineNumber: 8, column: 15 },
        },
      ],
    });
  });

  socket.on('room:leave', ({ snippetId }) => {
    socket.leave(`snippet:${snippetId}`);
  });
});

const PORT = 4173;

async function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${cmd} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function capture(url, outFilename, width, height) {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const outPath = path.resolve(SCREENSHOTS_DIR, outFilename);
  const artifactOutPath = path.resolve(ARTIFACT_SCREENSHOTS_DIR, outFilename);

  console.log(`Capturing: ${outFilename} (${width}x${height}) -> ${url}`);

  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--window-size=${width},${height}`,
    '--virtual-time-budget=4000',
    `--screenshot="${outPath}"`,
    url,
  ];

  await runCommand(`"${chromePath}"`, args);

  // Copy to brain artifact directory as well
  fs.copyFileSync(outPath, artifactOutPath);
  console.log(`Saved screenshot to ${outPath} and ${artifactOutPath}`);
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`Mock server running at http://127.0.0.1:${PORT}`);

  try {
    // 1. Signed-out view
    currentSimulatedMode = 'signed-out';
    await capture(
      `http://127.0.0.1:${PORT}/snippets/${SNIPPET_ID}`,
      'signed-out-1440.png',
      1440,
      900
    );
    await capture(
      `http://127.0.0.1:${PORT}/snippets/${SNIPPET_ID}`,
      'signed-out-1024.png',
      1024,
      768
    );

    // 2. Signed-in editor view with comments open
    currentSimulatedMode = 'signed-in';
    await capture(
      `http://127.0.0.1:${PORT}/snippets/${SNIPPET_ID}`,
      'signed-in-comments-1440.png',
      1440,
      900
    );
    await capture(
      `http://127.0.0.1:${PORT}/snippets/${SNIPPET_ID}`,
      'signed-in-comments-1024.png',
      1024,
      768
    );

    // 3. Read-only viewer view
    currentSimulatedMode = 'read-only';
    await capture(
      `http://127.0.0.1:${PORT}/snippets/${SNIPPET_ID}`,
      'read-only-viewer-1440.png',
      1440,
      900
    );
    await capture(
      `http://127.0.0.1:${PORT}/snippets/${SNIPPET_ID}`,
      'read-only-viewer-1024.png',
      1024,
      768
    );

    // 4. Empty-search state
    currentSimulatedMode = 'empty';
    await capture(
      `http://127.0.0.1:${PORT}/?q=nonexistent_search_query_xyz`,
      'empty-search-1440.png',
      1440,
      900
    );
    await capture(
      `http://127.0.0.1:${PORT}/?q=nonexistent_search_query_xyz`,
      'empty-search-1024.png',
      1024,
      768
    );

    console.log('All 8 screenshots captured successfully!');
  } finally {
    server.close();
    io.close();
  }
}

main().catch((err) => {
  console.error('Screenshot script error:', err);
  process.exit(1);
});

