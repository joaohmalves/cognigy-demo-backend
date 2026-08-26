import { Router } from 'express';
import { InMemoryBankingRepository } from '../onebank/store.js';
import {
  addSseClient,
  broadcastCognigyEvent,
  mapInboundEventToFrontend,
  removeSseClient
} from '../onebank/cognigyEvents.js';
import { registerSession } from '../onebank/cognigySession.js';
import { injectPageContext } from '../onebank/cognigyInject.js';

const router = Router();
const repo = new InMemoryBankingRepository();

router.post('/cognigy/session', (req, res) => {
  const { userId, sessionId } = req.body ?? {};
 
  if (!userId || !sessionId) {
    return res.status(400).json({ error: 'userId e sessionId são obrigatórios' });
  }
 
  registerSession(userId, sessionId);
  console.info('[Cognigy session] registrada', { userId, sessionId });
  res.status(200).json({ registered: true });
});

router.post('/page-context', async (req, res) => {
  const { userId, pageContext } = req.body ?? {};
 
  if (!userId || !pageContext) {
    return res.status(400).json({ error: 'userId e pageContext são obrigatórios' });
  }
 
  const result = await injectPageContext(userId, pageContext);
  res.status(202).json(result);
});

router.get('/customer', (_req, res) => {
  res.json(repo.getCustomer());
});

router.get('/cards', (_req, res) => {
  res.json(repo.getCards());
});

router.get('/cards/:id', (req, res) => {
  const card = repo.getCard(req.params.id);

  if (card) {
    res.json(card);
  } else {
    res.status(404).json({ error: 'Cartão não encontrado' });
  }
});

router.get('/cards/:id/purchases', (req, res) => {
  res.json(repo.getPurchases(req.params.id));
});

router.get('/cards/:id/statement', (req, res) => {
  res.json(repo.getStatement(req.params.id));
});

router.get('/cards/:id/invoice', (req, res) => {
  const card = repo.getCard(req.params.id);

  if (!card) {
    return res.status(404).json({
      error: 'Cartão não encontrado'
    });
  }

  res.json({
    id: 'INV-2026-08',
    dueDate: '2026-09-10',
    amount: card.limit - card.availableLimit
  });
});

router.get('/cards/compare/:cardA/:cardB', (req, res) => {
  const a = repo.getCard(req.params.cardA);
  const b = repo.getCard(req.params.cardB);

  if (a && b) {
    res.json({
      cardA: a,
      cardB: b
    });
  } else {
    res.status(404).json({
      error: 'Cartão não encontrado'
    });
  }
});

router.post('/cognigy/event', (req, res) => {
  console.info('[Cognigy inbound]', req.body);

  const event = mapInboundEventToFrontend(req.body);

  if (event) {
    broadcastCognigyEvent(event);

    res.status(202).json({
      accepted: true,
      dispatched: event
    });
  } else {
    res.status(202).json({
      accepted: true,
      dispatched: null,
      note: 'Corpo recebido mas nenhuma intenção reconhecida'
    });
  }
});

router.get('/cognigy/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  res.write('retry: 2000\n\n');

  addSseClient(res);

  req.on('close', () => {
    removeSseClient(res);
  });
});

router.post('/cognigy/action', (req, res) => {
  console.info('[Cognigy action]', req.body);

  res.status(202).json({
    accepted: true
  });
});

export default router;