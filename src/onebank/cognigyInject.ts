import { getActiveSessionId } from './cognigySession.js';

// Configure no .env do backend:
// COGNIGY_ENDPOINT_URL=https://endpoint-trial.cognigy.ai
// COGNIGY_URL_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
const ENDPOINT_URL = process.env.COGNIGY_ENDPOINT_URL;
const URL_TOKEN = process.env.COGNIGY_URL_TOKEN;

export async function injectPageContext(userId: string, pageContext: unknown) {
  if (!ENDPOINT_URL || !URL_TOKEN) {
    console.warn('[Cognigy inject] COGNIGY_ENDPOINT_URL/COGNIGY_URL_TOKEN não configurados no .env');
    return { skipped: true };
  }

  const sessionId = getActiveSessionId(userId);
  if (!sessionId) {
    console.warn(`[Cognigy inject] Nenhuma sessão ativa registrada para userId=${userId} (o Flow ainda não chamou /cognigy/session nesta chamada)`);
    return { skipped: true };
  }

  const url = `${ENDPOINT_URL}/inject/${URL_TOKEN}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, sessionId, text: '', data: { pageContext } }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[Cognigy inject] falhou (${response.status})`, body);
    return { skipped: false, ok: false, status: response.status };
  }

  return { skipped: false, ok: true };
}