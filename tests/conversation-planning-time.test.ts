import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ConversationService} from '../src/server/conversation.js';
import type {CareService} from '../src/server/care-access.js';
import type {Session} from '../src/server/session.js';
import type {Today} from '../src/shared/contracts.js';
import {testAuthority,bindTestInference} from './helpers/inference.js';

describe('instant planning entry respects current temporal facts',()=>{
 it.each([
  {time:'2026-10-14T12:00:00Z',recentMeal:false,offersBreakfast:true},
  {time:'2026-10-14T12:00:00Z',recentMeal:true,offersBreakfast:false},
  {time:'2026-10-14T22:00:00Z',recentMeal:false,offersBreakfast:false},
 ])('keeps planning available at $time with recentMeal=$recentMeal',async({time,recentMeal,offersBreakfast})=>{
  const session:Session={user_id:randomUUID(),session_id:randomUUID(),issued_at:1,expires_at:9999999999,access_token:'synthetic',refresh_token:'synthetic'};
  const today:Today={profile:{id:session.user_id,display_name:'Synthetic',time_zone:'America/Toronto',preferences:'',revision:1},local_date:'2026-10-14',tasks:[],meal_options:[{id:randomUUID(),name:'Synthetic oats',slots:['breakfast']}],checkin:null};
  if(recentMeal)today.activity_reports=[{target_id:today.meal_options[0].id,meal_slot:'breakfast',status:'completed',local_date:today.local_date,occurred_at:'2026-10-14T11:40:00Z'}];
  const care={authorize:async(s:Session)=>s,authority:()=>testAuthority(session),today:async()=>today} as unknown as CareService,respond=vi.fn();
  const service=new ConversationService(care,{bind:bindTestInference,respond},session.user_id,()=>new Date(time));
  try{
   const start=await service.start(session),reply=await service.turn(start.session_id,session,randomUUID(),"Let's plan the day");
   expect(reply.text.toLowerCase()).toContain('plan');expect(reply.text.includes('Synthetic oats')).toBe(offersBreakfast);expect(respond).not.toHaveBeenCalled();
  }finally{service.close();}
 });
});
