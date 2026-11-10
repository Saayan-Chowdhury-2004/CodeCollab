import http from 'http';
import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { logger } from './config/logger.ts';
import { attachSocketServer } from './realtime/socket-server.ts';

const app = createApp();
const server = http.createServer(app);
const io = attachSocketServer(server);

server.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Standalone backend server listening');
});

export { app, server, io };
