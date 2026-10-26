import type {CareService} from './care-access.js';
import type {Session} from './session.js';
import {OwnerSessionRenewal,type SessionRenewal} from './owner-session-renewal.js';

/** Same bounded credential propagation, qualified separately for one client.
 * This renews local care login only; inference policy remains independently
 * checked on every voice call. Revoking inference cannot disable the buttons. */
export class ClientSessionRenewal implements SessionRenewal {
  private readonly renewal:OwnerSessionRenewal;
  constructor(readonly ownerId:string,readonly clientActorId:string,readonly origin:string,now=()=>Date.now()){
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    let url:URL|undefined;try{url=new URL(origin);}catch{/* Invalid origins fail closed below. */}
    if(!uuid.test(ownerId)||!uuid.test(clientActorId)||ownerId===clientActorId||!url||url.origin!==origin||url.protocol!=='https:'||url.port!=='8443')
      throw Error('Client session maintenance requires the selected client HTTPS origin.');
    this.renewal=new OwnerSessionRenewal(clientActorId,now);
  }
  handles(session:Session){return session.user_id===this.clientActorId;}
  track(session:Session){return this.renewal.track(session);}
  authorize(care:Pick<CareService,'authorize'>,session:Session){return this.renewal.authorize(care,session);}
  authorizeConversation(care:Pick<CareService,'authorize'|'authority'>,session:Session){return this.renewal.authorizeConversation(care,session);}
}
