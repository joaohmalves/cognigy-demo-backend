interface ActiveSession {
  sessionId: string;
  updatedAt: number;
}

const activeSessions = new Map<string, ActiveSession>();

function key(vertical: string, userId: string) {
  return `${vertical}:${userId}`;
}

export function registerSession(vertical: string, userId: string, sessionId: string) {
  activeSessions.set(key(vertical, userId), { sessionId, updatedAt: Date.now() });
}

export function getActiveSessionId(vertical: string, userId: string): string | undefined {
  return activeSessions.get(key(vertical, userId))?.sessionId;
}