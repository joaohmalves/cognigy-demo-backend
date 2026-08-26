import type { Response } from 'express';

// Mapeia os nomes/ids que a Cognigy pode mandar para o CardId usado no app.
const CARD_ALIASES: Record<string, 'black' | 'platinum' | 'gold'> = {
  black: 'black', 'onebank black': 'black', preto: 'black',
  platinum: 'platinum', 'onebank platinum': 'platinum', platina: 'platinum',
  gold: 'gold', 'onebank gold': 'gold', ouro: 'gold',
};

function toCardId(value: unknown): 'black' | 'platinum' | 'gold' | undefined {
  if (typeof value !== 'string') return undefined;
  return CARD_ALIASES[value.trim().toLowerCase()];
}

export interface InboundCognigyBody {
  // A Cognigy pode mandar "intent" ou "topic" — aceitamos os dois nomes.
  intent?: string;
  topic?: string;
  card?: string;
  cardId?: string;
  cardA?: string;
  cardB?: string;
}

// Este é o "tradutor" entre o que a Cognigy manda (linguagem de negócio)
// e o evento que o front-end sabe processar (CognigyEvent em src/types/cognigy.ts).
export function mapInboundEventToFrontend(body: InboundCognigyBody) {
  const intent = (body.intent ?? body.topic ?? '').trim().toLowerCase();
  const cardA = toCardId(body.cardA);
  const cardB = toCardId(body.cardB);
  const card = toCardId(body.card ?? body.cardId);

  if ((intent === 'comparar_cartoes' || intent === 'compare_cards') && cardA && cardB) {
    return { type: 'COMPARE_CARDS', payload: { cardA, cardB } } as const;
  }
  if ((intent === 'cartao_detalhe' || intent === 'card_detail' || intent === 'novo_cartao') && card) {
    return { type: 'SHOW_CARD_DETAIL', payload: { card } } as const;
  }
  if (intent === 'cartao' || intent === 'cartoes' || intent === 'cards') {
    return { type: 'SHOW_CARDS_TOPIC' } as const;
  }
  if (intent === 'extrato' || intent === 'statement') {
    return { type: 'SHOW_STATEMENT' } as const;
  }
  if (intent === 'fatura' || intent === 'invoice') {
    return { type: 'SHOW_INVOICE' } as const;
  }
  if (intent === 'limite' || intent === 'credit_limit') {
    return { type: 'SHOW_CREDIT_LIMIT' } as const;
  }
  if (intent === 'compras' || intent === 'purchases') {
    return { type: 'SHOW_PURCHASES' } as const;
  }
  return null;
}

// Registro simples dos clientes SSE conectados (uma aba do navegador = um cliente).
const clients = new Set<Response>();

export function addSseClient(res: Response) {
  clients.add(res);
}

export function removeSseClient(res: Response) {
  clients.delete(res);
}

export function broadcastCognigyEvent(event: unknown) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(payload);
}
