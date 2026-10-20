import {z} from 'zod';
import {uuid} from './contracts.js';

export const preferenceCategory=z.enum(['meals','routine','task_support','conversation']);
export const preferenceDuration=z.enum(['lasting','today']);
const base={idempotency_key:uuid,confirmed:z.literal(true)};
export const preferenceCommandSchema=z.discriminatedUnion('type',[
  z.object({...base,type:z.literal('save_preference'),preference_id:uuid.nullable(),expected_revision:z.number().int().nonnegative(),
    category:preferenceCategory,text:z.string().trim().min(1).max(240),duration:preferenceDuration,local_date:z.iso.date().nullable()}).strict(),
  z.object({...base,type:z.literal('remove_preference'),preference_id:uuid,expected_revision:z.number().int().positive()}).strict(),
]).superRefine((command,ctx)=>{
  if(command.type==='save_preference'){
    if((command.preference_id===null)!==(command.expected_revision===0))ctx.addIssue({code:'custom',message:'Use the current preference revision for a correction.'});
    if((command.duration==='today')!==(command.local_date!==null))ctx.addIssue({code:'custom',message:'Today-only choices need a local date; lasting preferences do not.'});
  }
});
export type PreferenceCommand=z.infer<typeof preferenceCommandSchema>;
export interface ClientPreference {id:string;category:z.infer<typeof preferenceCategory>;text:string;duration:z.infer<typeof preferenceDuration>;local_date:string|null;revision:number;active:boolean;updated_at:string}
export interface PreferenceReceipt {command_id:string;result:'saved'|'removed';preference:ClientPreference;replayed:boolean}
export interface PendingPreference {command:PreferenceCommand;scope_matches:boolean;receipt:PreferenceReceipt|null}
export interface PreferenceWorkspace {local_date:string;items:ClientPreference[];pending:PendingPreference|null}
export const preferenceCategoryLabels:Record<ClientPreference['category'],string>={meals:'Meals',routine:'Daily routine',task_support:'Task support',conversation:'Conversation'};
export function preferenceReview(command:PreferenceCommand,items:ClientPreference[]):string {
  const prior=command.preference_id?items.find(item=>item.id===command.preference_id&&item.revision===command.expected_revision):undefined;
  if(command.preference_id&&!prior)throw new Error('This preference changed. Review the current saved value.');
  if(command.type==='remove_preference')return `Remove your preference: “${prior!.text}”?`;
  return `${prior?'Change':'Save'} your ${preferenceCategoryLabels[command.category].toLowerCase()} preference ${command.duration==='lasting'?'for future days':`for today only (${command.local_date})`}: “${command.text}”?`;
}
