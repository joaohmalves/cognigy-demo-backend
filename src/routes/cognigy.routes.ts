import { Router } from 'express';
import { registerSession } from '../cognigy/session.js';
import { injectPageContext } from '../cognigy/inject.js';

const router = Router();

// O Flow de CADA vertical chama isso uma vez, no início da conversa.
// POST /api/cognigy/:vertical/session   body: { userId, sessionId }
// Ex: POST /api/cognigy/banking/session
router.post('/:vertical/session', (req, res) => {
  const { vertical } = req.params;
  const { userId, sessionId } = req.body ?? {};

  if (!userId || !sessionId) {
    return res.status(400).json({ error: 'userId e sessionId são obrigatórios' });
  }

  registerSession(vertical, userId, sessionId);
  console.info('[Cognigy session] registrada', { vertical, userId, sessionId });
  res.status(200).json({ registered: true });
});

// Cada front-end (OneBank, seguros, etc.) chama isso a cada mudança de tela.
// POST /api/cognigy/:vertical/page-context   body: { userId, pageContext }
router.post('/:vertical/page-context', async (req, res) => {
  const { vertical } = req.params;
  const { userId, pageContext } = req.body ?? {};

  if (!userId || !pageContext) {
    return res.status(400).json({ error: 'userId e pageContext são obrigatórios' });
  }

  const result = await injectPageContext(vertical, userId, pageContext);
  res.status(202).json(result);
});

export default router;