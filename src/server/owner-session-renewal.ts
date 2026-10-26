import type {CareService} from './care-access.js';
import type {Session} from './session.js';
import {sessionLifetimeSeconds} from './session.js';
import {ApiError} from './errors.js';

interface ActiveLogin {requests:Set<Session>;generation:number;authorizing:number}
export type SessionRenewal = Pick<OwnerSessionRenewal, 'ownerId' | 'track' | 'authorize' | 'authorizeConversation'>;
/** Request-local credential propagation for the separately qualified owner copy.
 * Incoming cookies still pass the care service's ordinary authorization first.
 * Only requests already authorized for this exact login receive a peer renewal;
 * request-specific reviewed authority is never copied between requests. */
export class OwnerSessionRenewal {
  private active=new Map<string,ActiveLogin>();
  private requests=0;
  constructor(readonly ownerId:string,private readonly now=()=>Date.now()){}
  private key(session:Session){
    if(session.user_id!==this.ownerId)throw new ApiError(403,'owner_session_only','This maintenance path is limited to the owner test account.');
    return session.user_id+':'+session.session_id;
  }
  private entry(key:string){let entry=this.active.get(key);if(!entry){entry={requests:new Set(),generation:0,authorizing:0};this.active.set(key,entry);}return entry;}
  private release(key:string,entry:ActiveLogin){if(!entry.requests.size&&!entry.authorizing&&this.active.get(key)===entry)this.active.delete(key);}
  track(session:Session):()=>void {
    const key=this.key(session);
    if(this.requests>=128)throw new ApiError(503,'owner_session_busy','Too many test requests are in progress. Please try again.');
    const entry=this.entry(key);entry.requests.add(session);this.requests++;
    let released=false;
    return()=>{if(released)return;released=true;entry.requests.delete(session);this.requests--;this.release(key,entry);};
  }
  async authorizeConversation(care:Pick<CareService,'authorize'|'authority'>,session:Session):Promise<Session>{
    const entry=this.active.get(this.key(session));
    if(entry?.requests.has(session))return this.authorize(care,session);
    // Detached preparation cannot deliver a replacement browser cookie. Check
    // fresh SQL authority without rotating its credentials; expiry cancels the
    // preparation so the browser can renew normally on its next real request.
    if((session.issued_at+sessionLifetimeSeconds(session))*1000<=this.now())
      throw new ApiError(401,'unauthorized','Please sign in again.');
    if(!care.authority)throw new ApiError(503,'scope_unavailable','Nancy’s account permissions need review.');
    await care.authority(session);return session;
  }
  async authorize(care:Pick<CareService,'authorize'>,session:Session):Promise<Session>{
    const key=this.key(session),entry=this.entry(key);entry.authorizing++;
    try{
      for(let attempt=0;attempt<3;attempt++){
        const generation=entry.generation;
        let authorized:Session;
        try{authorized=await care.authorize(session);}
        catch(error){
          // An already-authorized in-flight request can lose its old SQL token
          // check to a peer rotation. Retry only that tracked request using its
          // propagated credentials. A fresh/stale incoming cookie has no lease;
          // a real revocation still fails the repeated SQL authorization.
          if(error instanceof ApiError&&error.status===401&&entry.requests.has(session)&&generation!==entry.generation)continue;
          throw error;
        }
        // A peer can rotate while this SQL check is in flight. Recheck using
        // our already-authorized request's updated credentials, not its result.
        if(generation!==entry.generation)continue;
        if(authorized.user_id!==session.user_id||authorized.session_id!==session.session_id)
          throw new ApiError(403,'scope_changed','Your sign-in changed. Start a new conversation.');
        const changed=authorized.access_token!==session.access_token||authorized.refresh_token!==session.refresh_token;
        const update=(target:Session)=>{
          target.access_token=authorized.access_token;target.refresh_token=authorized.refresh_token;
          target.expires_at=authorized.expires_at;target.issued_at=authorized.issued_at;
          if(authorized.remember_device===undefined)delete target.remember_device;else target.remember_device=authorized.remember_device;
        };
        update(session);
        if(changed){entry.generation++;for(const peer of entry.requests)update(peer);}
        return session;
      }
      throw new ApiError(503,'owner_session_busy','Your test sign-in is renewing. Please try again.');
    }finally{entry.authorizing--;this.release(key,entry);}
  }
}
