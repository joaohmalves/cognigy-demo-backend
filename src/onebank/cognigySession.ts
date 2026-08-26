// Guarda, em memória, qual é o sessionId ativo no Cognigy para cada userId.
// O Flow precisa nos avisar (uma vez, no início da conversa) qual é o sessionId
// dele, porque é o Cognigy quem gera esse id — a gente não tem como adivinhar.
interface ActiveSession {
  sessionId: string;
  updatedAt: number;
}

const activeSessions = new Map<string, ActiveSession>();

export function registerSession(userId: string, sessionId: string) {
  activeSessions.set(userId, { sessionId, updatedAt: Date.now() });
}

export function getActiveSessionId(userId: string): string | undefined {
  return activeSessions.get(userId)?.sessionId;
}