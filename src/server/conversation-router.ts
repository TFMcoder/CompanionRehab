import type {ConversationService} from './conversation.js';
import type {Session} from './session.js';

/** The HTTP surface, independent of either conversation's private state. */
export type ConversationRuntime = Pick<ConversationService,
  'voiceAccess'|'start'|'turn'|'speech'|'preparedAudio'|'played'|'received'|'interrupt'|'cancelTurn'|
  'end'|'endLogin'|'close'|'prepareMeals'|'mealPreparationStatus'|'prepareConversation'|
  'conversationPreparationStatus'|'speechPartSize'> & {speechPartSizeFor?(session:Session):120|72};

/** One explicitly selected client uses the qualified release; all other actors
 * retain the ordinary service. Revocation never falls back to another route. */
export class ClientConversationRouter implements ConversationRuntime {
  readonly speechPartSize=120 as const;
  constructor(private readonly clientActorId:string,private readonly ordinary:ConversationRuntime,private readonly selected:ConversationRuntime){}
  private route(session:Session){return session.user_id===this.clientActorId?this.selected:this.ordinary;}
  speechPartSizeFor(session:Session){const route=this.route(session);return route.speechPartSizeFor?.(session)??route.speechPartSize;}
  voiceAccess(...args:Parameters<ConversationService['voiceAccess']>){return this.route(args[0]).voiceAccess(...args);}
  start(...args:Parameters<ConversationService['start']>){return this.route(args[0]).start(...args);}
  turn(...args:Parameters<ConversationService['turn']>){return this.route(args[1]).turn(...args);}
  speech(...args:Parameters<ConversationService['speech']>){return this.route(args[1]).speech(...args);}
  preparedAudio(...args:Parameters<ConversationService['preparedAudio']>){return this.route(args[1]).preparedAudio(...args);}
  played(...args:Parameters<ConversationService['played']>){return this.route(args[1]).played(...args);}
  received(...args:Parameters<ConversationService['received']>){return this.route(args[1]).received(...args);}
  interrupt(...args:Parameters<ConversationService['interrupt']>){return this.route(args[1]).interrupt(...args);}
  cancelTurn(...args:Parameters<ConversationService['cancelTurn']>){return this.route(args[1]).cancelTurn(...args);}
  end(...args:Parameters<ConversationService['end']>){return this.route(args[1]).end(...args);}
  prepareMeals(...args:Parameters<ConversationService['prepareMeals']>){return this.route(args[0]).prepareMeals(...args);}
  mealPreparationStatus(...args:Parameters<ConversationService['mealPreparationStatus']>){return this.route(args[0]).mealPreparationStatus(...args);}
  prepareConversation(...args:Parameters<ConversationService['prepareConversation']>){return this.route(args[1]).prepareConversation(...args);}
  conversationPreparationStatus(...args:Parameters<ConversationService['conversationPreparationStatus']>){return this.route(args[1]).conversationPreparationStatus(...args);}
  endLogin(login:string){this.ordinary.endLogin(login);this.selected.endLogin(login);}
  close(){this.ordinary.close();this.selected.close();}
}
