import type {ClientView} from './contracts.js';
export const clientTabs=[['tasks','Tasks'],['meals','Meals'],['groceries','Groceries'],['progress','Progress'],['ask_for_help','Ask for Help']] as const;
export const clientDestinations:readonly ClientView[]=['my_day',...clientTabs.map(([id])=>id),'ways_to_use','suggestions'];
export type ConversationPurpose='general'|'help'|'suggestions';
