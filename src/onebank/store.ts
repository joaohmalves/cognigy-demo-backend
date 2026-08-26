import { cards, customer, purchases } from './mocks/data.js';
export interface BankingRepository { getCustomer(): typeof customer; getCards(): typeof cards; getCard(id:string): (typeof cards)[number] | undefined; getPurchases(id:string): typeof purchases; getStatement(id:string): typeof purchases; }
export class InMemoryBankingRepository implements BankingRepository { getCustomer(){return customer;} getCards(){return cards;} getCard(id:string){return cards.find(c=>c.id===id);} getPurchases(_:string){return purchases.filter(p=>p.type==='purchase');} getStatement(_:string){return purchases;} }
