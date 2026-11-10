import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './transport.ts';
import { refreshSessionTokens } from './client.ts';

let socketInstance: Socket | null = null;
let currentTokenUsed: string | null = null;

export function getSocket(): Socket {
  const token = getAccessToken();

  if (socketInstance) {
    if (token !== currentTokenUsed) {
      currentTokenUsed = token;
      socketInstance.auth = token ? { token } : {};
      if (socketInstance.connected && token) {
        socketInstance.emit('auth:refresh', { token });
      } else if (socketInstance.connected && !token) {
        // Reconnect as anonymous viewer after logout
        socketInstance.disconnect().connect();
      }
    }
    return socketInstance;
  }

  const baseUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');
  currentTokenUsed = token;

  socketInstance = io(baseUrl, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    withCredentials: true,
    auth: token ? { token } : {},
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });

  // Handle mid-session access token expiry seamlessly without dropping rooms
  socketInstance.on('auth:expired', async () => {
    const refreshed = await refreshSessionTokens();
    if (refreshed?.accessToken && socketInstance) {
      currentTokenUsed = refreshed.accessToken;
      socketInstance.auth = { token: refreshed.accessToken };
      socketInstance.emit(
        'auth:refresh',
        { token: refreshed.accessToken },
        (ack?: { ok: boolean }) => {
          if (ack?.ok && socketInstance) {
            const pathParts = window.location.pathname.split('/');
            const snippetIdx = pathParts.indexOf('snippets');
            const snippetId = snippetIdx !== -1 && pathParts[snippetIdx + 1] ? pathParts[snippetIdx + 1] : null;
            if (snippetId) {
              socketInstance.emit('snippet:join', { snippetId });
            }
          }
        }
      );
    }
  });

  return socketInstance;
}

export function syncSocketAuth(): void {
  if (!socketInstance) return;
  const token = getAccessToken();
  if (token === currentTokenUsed) return;

  currentTokenUsed = token;
  socketInstance.auth = token ? { token } : {};
  if (socketInstance.connected) {
    if (token) {
      socketInstance.emit('auth:refresh', { token });
    } else {
      socketInstance.disconnect().connect();
    }
  }
}

export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
    currentTokenUsed = null;
  }
}
