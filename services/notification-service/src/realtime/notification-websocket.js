import { WebSocket, WebSocketServer } from 'ws';
import { verifyAccessToken } from '../middleware/auth.js';

const POLICY_VIOLATION = 1008;

function rejectUpgrade(socket, statusLine) {
  socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createNotificationWebSocket({ server, config, authTimeoutMs = 5000 }) {
  const webSocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const socketsByUser = new Map();
  const adminSockets = new Set();
  const identities = new Map();
  const authTimers = new Map();
  let closed = false;

  function cleanup(socket) {
    const timer = authTimers.get(socket);
    if (timer) clearTimeout(timer);
    authTimers.delete(socket);

    const identity = identities.get(socket);
    if (!identity) return;
    identities.delete(socket);
    const userSockets = socketsByUser.get(identity.id);
    if (userSockets) {
      userSockets.delete(socket);
      if (userSockets.size === 0) socketsByUser.delete(identity.id);
    }
    adminSockets.delete(socket);
  }

  function register(socket, identity) {
    identities.set(socket, identity);
    const userSockets = socketsByUser.get(identity.id) ?? new Set();
    userSockets.add(socket);
    socketsByUser.set(identity.id, userSockets);
    if (typeof identity.role === 'string' && identity.role.toUpperCase() === 'ADMIN') {
      adminSockets.add(socket);
    }
  }

  function closeForPolicyViolation(socket, reason) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(POLICY_VIOLATION, reason);
    }
  }

  function handleConnection(socket) {
    const authTimer = setTimeout(() => {
      if (!identities.has(socket)) closeForPolicyViolation(socket, 'Authentication required');
    }, authTimeoutMs);
    authTimer.unref?.();
    authTimers.set(socket, authTimer);

    socket.once('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        closeForPolicyViolation(socket, 'Invalid authentication');
        return;
      }
      if (message?.type !== 'AUTH' || typeof message.token !== 'string') {
        closeForPolicyViolation(socket, 'Invalid authentication');
        return;
      }
      try {
        const identity = verifyAccessToken(message.token, config);
        register(socket, identity);
        clearTimeout(authTimers.get(socket));
        authTimers.delete(socket);
        socket.send(JSON.stringify({ type: 'AUTH_OK' }));
      } catch {
        closeForPolicyViolation(socket, 'Invalid authentication');
      }
    });
    socket.on('close', () => cleanup(socket));
    socket.on('error', () => cleanup(socket));
  }

  function handleUpgrade(request, socket, head) {
    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      rejectUpgrade(socket, '400 Bad Request');
      return;
    }
    if (closed || pathname !== '/ws') {
      rejectUpgrade(socket, '404 Not Found');
      return;
    }
    const requestOrigin = request.headers.origin;
    if (requestOrigin && requestOrigin !== config.frontendOrigin) {
      rejectUpgrade(socket, '403 Forbidden');
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit('connection', client, request);
    });
  }

  function sendTo(sockets, message) {
    if (!sockets) return;
    const encoded = JSON.stringify(message);
    for (const socket of [...sockets]) {
      if (socket.readyState !== WebSocket.OPEN) {
        cleanup(socket);
        continue;
      }
      try {
        socket.send(encoded, (error) => {
          if (error) cleanup(socket);
        });
      } catch {
        cleanup(socket);
      }
    }
  }

  server.on('upgrade', handleUpgrade);
  webSocketServer.on('connection', handleConnection);

  return {
    publishNotificationCreated({ notificationId, eventType, userId, adminVisible }) {
      sendTo(socketsByUser.get(userId), {
        type: 'NOTIFICATION_CREATED',
        notification_id: notificationId,
        event_type: eventType,
        audience: 'USER'
      });
      if (adminVisible) {
        sendTo(adminSockets, {
          type: 'NOTIFICATION_CREATED',
          notification_id: notificationId,
          event_type: eventType,
          audience: 'ADMIN'
        });
      }
    },
    getConnectionCounts() {
      return {
        users: socketsByUser.size,
        userConnections: [...socketsByUser.values()].reduce((total, sockets) => total + sockets.size, 0),
        admins: adminSockets.size
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      server.off('upgrade', handleUpgrade);
      for (const timer of authTimers.values()) clearTimeout(timer);
      authTimers.clear();
      for (const socket of webSocketServer.clients) socket.terminate();
      await new Promise((resolve) => webSocketServer.close(() => resolve()));
      socketsByUser.clear();
      adminSockets.clear();
      identities.clear();
    }
  };
}
