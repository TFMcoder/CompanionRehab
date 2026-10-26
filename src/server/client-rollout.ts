import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {z} from 'zod';
import {ApiError} from './errors.js';
import {NANCY_POLICY_VERSION,type InferenceBinding,type InferenceScope} from './inference-binding.js';
import type {ResolveCaregiverInference} from './caregiver-inference.js';

/** One deliberately selected release, not a browser/model-controlled feature selector. */
export const clientRolloutSchema=z.object({
  schema_version:z.literal(1),enabled:z.boolean(),owner_actor_id:z.uuid(),client_actor_id:z.uuid(),participant_id:z.uuid(),
  account_binding_id:z.uuid(),host_id:z.string().regex(/^urn:uuid:[a-f0-9-]{36}$/i),
  caregiver_authorization_ref:z.string().regex(/^sha256:[a-f0-9]{64}$/),
  approved_at:z.iso.datetime(),authorization_ref:z.string().min(1).max(300),
  profile:z.literal('sol-low'),context_mode:z.literal('prepared-v1'),speech_mode:z.literal('heart-latency-v1'),
  read_mode:z.literal('quick-v1'),reply_mode:z.literal('spoken-v1'),meal_mode:z.literal('ahead-v1'),
  continuation_mode:z.literal('dialogue-v1'),chat_mode:z.literal('ahead-v1'),reference_mode:z.literal('verified-v1'),
  connection_mode:z.literal('warm-v2'),
}).strict().superRefine((value,context)=>{
  // Actor and participant IDs are different namespaces; an established
  // participant may legitimately reuse an actor UUID. The speaker must still
  // be a different actor from the account owner.
  if(value.owner_actor_id===value.client_actor_id)
    context.addIssue({code:'custom',message:'The actual client speaker must differ from the caregiver account owner.'});
});
export type ClientRolloutConfig=z.infer<typeof clientRolloutSchema>;
export const clientRolloutSettings=Object.freeze({model:'gpt-6-sol' as const,effort:'low' as const,prepareContext:true,speechPartSize:72 as const,
  quickReads:true,spokenReplies:true,prepareMealsAhead:true,dialogueReplies:true,prepareChat:true,verifiedReferences:true,warmConnection:true,quickConversation:true});
export interface ClientRolloutAuthorization {
  readonly ownerActorId:string;readonly actorId:string;readonly clientId:string;readonly accountBindingId:string;readonly hostId:string;
  readonly caregiverAuthorizationRef:string;readonly policyHash:string;readonly policyVersion:string;
  readonly settings:typeof clientRolloutSettings;
}
export interface ClientRolloutAuthorizer {
  authorizeScope(scope:InferenceScope):Promise<ClientRolloutAuthorization|undefined>;
  authorizeBinding(binding:InferenceBinding):Promise<ClientRolloutAuthorization>;
}
export function clientRolloutPath(path:string):string {
  const result=resolve(path),rel=relative(resolve('.local/runtime'),result);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Client rollout configuration must remain under ignored local runtime storage.');
  return result;
}

/** The file and both original caregiver grants are rechecked on every use.
 * A release change is a binding change, including during a model/tool round. */
export class ClientRolloutPolicy implements ClientRolloutAuthorizer {
  readonly path:string;
  constructor(path:string,readonly ownerId:string,private readonly caregiver:ResolveCaregiverInference){this.path=clientRolloutPath(path);}
  async configuration():Promise<Readonly<ClientRolloutConfig>|undefined>{
    let config:ClientRolloutConfig;
    try{config=clientRolloutSchema.parse(JSON.parse(await readFile(this.path,'utf8')));}
    catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')return;
      throw new ApiError(503,'client_rollout_unavailable','The selected Nancy release needs review. You can use the buttons.');
    }
    if(config.owner_actor_id!==this.ownerId)throw new ApiError(403,'client_rollout_changed','The selected caregiver connection changed.');
    return config.enabled?Object.freeze(config):undefined;
  }
  async authorizeScope(scope:InferenceScope):Promise<ClientRolloutAuthorization|undefined>{
    if(scope.actor_id===this.ownerId||scope.active_role!=='client')return;
    const config=await this.configuration();
    if(!config||config.client_actor_id!==scope.actor_id||config.participant_id!==scope.client_id)return;
    const authority=await this.caregiver(scope);
    const fresh=await this.configuration();
    if(!fresh||JSON.stringify(fresh)!==JSON.stringify(config))
      throw new ApiError(403,'client_rollout_changed','The selected Nancy release changed while checking access. Start a new conversation.');
    if(!authority||authority.ownerActorId!==this.ownerId||authority.accountBindingId!==config.account_binding_id
      ||authority.hostId!==config.host_id||authority.authorizationRef!==config.caregiver_authorization_ref)
      throw new ApiError(403,'client_rollout_changed','The selected client release or caregiver access changed. Start a new conversation.');
    const policyHash=createHash('sha256').update(JSON.stringify(config)).digest('hex');
    return Object.freeze({ownerActorId:this.ownerId,actorId:config.client_actor_id,clientId:config.participant_id,accountBindingId:config.account_binding_id,
      hostId:config.host_id,caregiverAuthorizationRef:config.caregiver_authorization_ref,policyHash,
      policyVersion:`${NANCY_POLICY_VERSION}:client-rollout-v1:${policyHash}`,settings:clientRolloutSettings});
  }
  async authorizeBinding(binding:InferenceBinding):Promise<ClientRolloutAuthorization>{
    const selected=await this.authorizeScope(binding);
    if(!selected||binding.route_id!=='chatgpt_plan_caregiver'||binding.qualification!=='caregiver_authorized'
      ||binding.account_owner_actor_id!==this.ownerId||binding.account_binding_id!==selected.accountBindingId
      ||binding.authorization_ref!==selected.caregiverAuthorizationRef||binding.policy_version!==selected.policyVersion)
      throw new ApiError(403,'client_rollout_changed','The selected Nancy release or conversation scope changed. Start a new conversation.');
    return selected;
  }
}
