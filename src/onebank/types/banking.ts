export type CardId = 'black' | 'platinum' | 'gold';
export interface Card { id: CardId; name: string; number: string; holder: string; expiry: string; limit: number; availableLimit: number; color: string; perks: Record<string, string>; }
export interface Purchase { id: string; date: string; merchant: string; category: string; amount: number; type: 'purchase' | 'payment' | 'refund' | 'credit'; month: string; }
export interface Customer { name: string; agency: string; account: string; balance: number; }
