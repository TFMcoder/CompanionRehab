import {vi} from 'vitest';
import type {Today} from '../../src/shared/contracts';
export const clientDay:Today={profile:{id:'11111111-1111-4111-8111-111111111111',display_name:'Pat',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-19',checkin:null,tasks:[{id:'22222222-2222-4222-8222-222222222222',title:'Fold laundry',time_hint:null,urgency:'high',scheduled_time:'10:30',duration_minutes:20}],meal_options:[],appointments:[]};
export const clientResponse=(data:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data}) as Response;
export function clientBackend(options:{today?:Today;microsoft?:boolean;local?:boolean;voiceAvailable?:boolean;override?:(path:string,init?:RequestInit)=>Response|undefined|Promise<Response|undefined>}={}){
 const state={today:options.today??structuredClone(clientDay),scope:'client-scope-a',voiceAvailable:options.voiceAvailable??true};
 const fetch=vi.fn(async(raw:string|URL|Request,init?:RequestInit)=>{const path=String(raw);const overridden=await options.override?.(path,init);if(overridden)return overridden;
  if(path==='/api/config')return clientResponse({configured:true,assistant_name:'Nancy',missing:[],voice_available:state.voiceAvailable,voice_transport:'local'});
  if(path==='/api/auth/session')return clientResponse({authenticated:true,role:'client',participant_id:state.today.profile!.id,scope_key:state.scope,voice_eligible:true,voice_connection:'caregiver_authorized',task_requests_available:true,local_features_available:options.local??false,microsoft_available:options.microsoft??false});
  if(path==='/api/today')return clientResponse(state.today);
  if(path==='/api/groceries')return clientResponse({items:[{id:'g1',name:'Apples',quantity:'2'}]});
  if(path==='/api/meals-groceries')return clientResponse({groceries:[{id:'g1',name:'Apples',amount:2,unit:null,legacy_quantity:null,acquired_at:null}],role:'client',pantry:[],shares:[],accepted_meals:[],proposals:[],can_edit:true});
  if(path.startsWith('/api/microsoft/calendar?'))return clientResponse({source:'microsoft',fetched_at:'2026-10-19T16:00:00Z',calendars:[{id:'calendar',result:{items:[{id:'event',subject:'Synthetic appointment',start:'2026-10-19T22:00:00Z',end:'2026-10-19T22:15:00Z',isAllDay:false,isCancelled:false}],fetchedAt:'2026-10-19T16:00:00Z',complete:true,truncation:null}}]});
  if(path==='/api/nancy-suggestions')return clientResponse({role:'client',items:[]});
  if(path.startsWith('/api/progress?'))return clientResponse({role:'client',trend:{days_with_accepted_plan:0,days_in_range:7,average_reported_percent:null,days_with_missing_reports:null,corrected_days:0},days:[],access_grants:[],can_approve_rules:true,can_export:true,active_rules:null,clinical_config:null,allowed_fields:['local_date','status']});
  if(path==='/api/prompts/claim'||path==='/api/prompts/resume')return clientResponse(null);
  if(path==='/api/auth/logout')return clientResponse({ok:true});
  throw Error('Unexpected synthetic request '+path);
 });vi.stubGlobal('fetch',fetch);return {state,fetch};
}
