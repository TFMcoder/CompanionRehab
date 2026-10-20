import {z} from 'zod';
import type {CareService} from './care-access.js';
import type {Session} from './session.js';
import {ApiError} from './errors.js';
import {preferenceCommandSchema,preferenceReview} from '../shared/preference-contracts.js';

export const preferenceTools=[{type:'function',name:'prepare_preference',strict:false,
  description:'Prepare one explicit preference save, correction or removal for spoken review. Never writes. For save_preference include category,text,duration,local_date; for remove_preference omit them. The application supplies confirmation and the receipt key.',
  parameters:{type:'object',additionalProperties:false,required:['type','preference_id','expected_revision'],properties:{
    type:{type:'string',enum:['save_preference','remove_preference']},preference_id:{type:['string','null'],description:'Null for a new preference; exact current ID for change/removal.'},expected_revision:{type:'integer',minimum:0},
    category:{type:'string',enum:['meals','routine','task_support','conversation']},text:{type:'string',minLength:1,maxLength:240},duration:{type:'string',enum:['lasting','today']},local_date:{type:['string','null'],description:'Current YYYY-MM-DD for today-only, null for lasting.'},
  }}}];
export async function preparePreference(care:CareService,session:Session,raw:unknown,key:string){
  if(!care.preferences||!care.preferenceCommand)throw new ApiError(503,'preferences_unavailable','Preferences are not available.');
  const input=z.record(z.string(),z.unknown()).parse(raw);
  if('idempotency_key' in input||'confirmed' in input)throw new ApiError(400,'invalid_input','The application supplies confirmation and the receipt key.');
  const command=preferenceCommandSchema.parse({...input,idempotency_key:key,confirmed:true}),view=await care.preferences(session);
  if(command.type==='save_preference'&&command.duration==='today'&&command.local_date!==view.local_date)throw new ApiError(409,'preference_review_required','Use the current local day for a today-only choice.');
  let text:string;try{text=preferenceReview(command,view.items);}catch{throw new ApiError(409,'preference_review_required','This preference changed. Review the current saved value.');}
  return {command,text:text+' Say save this preference to confirm, or tell me what to change.'};
}
