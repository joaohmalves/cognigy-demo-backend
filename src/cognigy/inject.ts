import { getAgentConfig } from '../config/cognigyAgents.js';
import { getActiveSessionId } from './session.js';

export async function injectPageContext(vertical: string, userId: string, payload: unknown) {
  const config = getAgentConfig(vertical);
  if (!config) {
    console.warn(`[Cognigy inject] vertical "${vertical}" não configurada no .env (veja src/config/cognigyAgents.ts)`);
    return { skipped: true };
  }

  const sessionId = getActiveSessionId(vertical, userId);
  if (!sessionId) {
    console.warn(`[Cognigy inject] sem sessão ativa para vertical=${vertical} userId=${userId}`);
    return { skipped: true };
  }

  const url = `${config.endpointUrl}/inject/${config.urlToken}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, sessionId, text: '', data: payload }),
  });

  if (!response.ok) {
    console.error(`[Cognigy inject] falhou (${response.status})`, await response.text().catch(() => ''));
    return { skipped: false, ok: false, status: response.status };
  }

  return { skipped: false, ok: true };
}