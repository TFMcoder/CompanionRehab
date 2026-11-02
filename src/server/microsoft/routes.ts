import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {ApiError} from '../errors.js';
import type {Session} from '../session.js';
import type {MicrosoftService} from './service.js';
import {microsoftReadRangeSchema,microsoftSelectionSchema,microsoftCalendarSelectionSchema,microsoftUnavailable,microsoftPrepareSchema,microsoftConfirmSchema} from '../../shared/microsoft-contracts.js';

export const microsoftCallbackPath='/api/microsoft/callback';
export function registerMicrosoftRoutes(app:FastifyInstance,options:{service?:MicrosoftService;secondaryService?:MicrosoftService;calendarReader?:Pick<MicrosoftService,'calendarContext'>;sessions:WeakMap<FastifyRequest,Session>;origin:string;bindingCookieName?:'nancy_microsoft_binding'|'nancy_test_microsoft_binding';limit:(request:FastifyRequest,key:string,maximum:number)=>void}){
 const {sessions,origin,limit}=options;
 const service=()=>{if(!options.service)throw new ApiError(503,'microsoft_not_configured','The Outlook connection is not available yet.');return options.service;};
 const bindingCookie=options.bindingCookieName??'nancy_microsoft_binding';
 const calendarBindingCookie=bindingCookie==='nancy_test_microsoft_binding'?'nancy_test_microsoft_calendar_binding':'nancy_microsoft_calendar_binding';
 const secondary=()=>{if(!options.secondaryService)throw new ApiError(503,'microsoft_not_configured','The additional calendar connection is not available yet.');return options.secondaryService;};
 const cookie={httpOnly:true,secure:origin.startsWith('https:'),sameSite:'lax' as const,path:'/api/microsoft',maxAge:600};
 const empty=z.object({}).strict();
 const bounded=(request:FastifyRequest)=>limit(request,`microsoft:${sessions.get(request)!.user_id}`,20);
 app.get('/api/microsoft',async request=>options.service?options.service.status(sessions.get(request)!):microsoftUnavailable);
 app.post('/api/microsoft/connect',async(request,reply)=>{
  empty.parse(request.body);bounded(request);const result=await service().begin(sessions.get(request)!);
  reply.setCookie(bindingCookie,result.browserBinding,cookie);return {authorization_url:result.authorization_url};
 });
 app.get(microsoftCallbackPath,async(request,reply)=>{
  // Keep callback URLs, state, code and provider descriptions out of logs and clean the address before rendering UI.
  limit(request,`microsoft-callback:${request.ip}`,30);
  let callbackCookie:string=bindingCookie,callbackMarker='';
  try{
   const query=z.object({state:z.string().min(1).max(512),code:z.string().min(1).max(16000).optional(),error:z.string().max(256).optional(),error_description:z.string().max(4096).optional(),error_uri:z.string().max(2048).optional(),session_state:z.string().max(512).optional()}).strict().parse(request.query);
   let target=options.service;
   if(options.secondaryService){
    const [primaryOwns,secondaryOwns]=await Promise.all([options.service?.ownsCallbackState(query.state)??false,options.secondaryService.ownsCallbackState(query.state)]);
    if(primaryOwns===secondaryOwns)throw Error('No unique authorized callback source.');
    if(secondaryOwns){target=options.secondaryService;callbackCookie=calendarBindingCookie;callbackMarker='calendar-';}
   }
   if(!target)throw Error('No authorized callback source.');
   await target.callback(query,request.cookies[callbackCookie]);
   return reply.code(303).redirect('/?microsoft='+callbackMarker+'finish');
  }catch{return reply.clearCookie(callbackCookie,cookie).code(303).redirect('/?microsoft='+callbackMarker+'failed');}
 });
 app.post('/api/microsoft/finish',async(request,reply)=>{
  empty.parse(request.body);bounded(request);
  try{return await service().finish(sessions.get(request)!,request.cookies[bindingCookie]);}
  finally{reply.clearCookie(bindingCookie,cookie);}
 });
 app.get('/api/microsoft/resources',async request=>{bounded(request);return service().resources(sessions.get(request)!);});
 app.post('/api/microsoft/selection',async request=>{bounded(request);return service().select(sessions.get(request)!,microsoftSelectionSchema.parse(request.body));});
 app.get('/api/microsoft/context',async request=>{bounded(request);return service().read(sessions.get(request)!,microsoftReadRangeSchema.parse(request.query));});
 app.get('/api/microsoft/calendar',async request=>{bounded(request);return (options.calendarReader??service()).calendarContext(sessions.get(request)!,microsoftReadRangeSchema.parse(request.query));});
 app.post('/api/microsoft/actions/prepare',async request=>{bounded(request);return service().prepareAction(sessions.get(request)!,microsoftPrepareSchema.parse(request.body));});
 app.post('/api/microsoft/actions/confirm',async request=>{bounded(request);return service().confirmAction(sessions.get(request)!,microsoftConfirmSchema.parse(request.body));});
 app.get('/api/microsoft/actions',async request=>{bounded(request);return service().recentActions(sessions.get(request)!);});
 app.get('/api/microsoft/actions/:id',async request=>{bounded(request);const {id}=z.object({id:z.uuid()}).parse(request.params);return service().actionReceipt(sessions.get(request)!,id,true);});
 app.get('/api/microsoft/actions/:id/review',async request=>{bounded(request);const {id}=z.object({id:z.uuid()}).parse(request.params);return service().actionReview(sessions.get(request)!,id);});
 app.post('/api/microsoft/disconnect',async(request,reply)=>{empty.parse(request.body);bounded(request);const result=await service().disconnect(sessions.get(request)!);reply.clearCookie(bindingCookie,cookie);return result;});
 app.get('/api/microsoft/calendar-source',async request=>options.secondaryService?options.secondaryService.status(sessions.get(request)!):microsoftUnavailable);
 app.post('/api/microsoft/calendar-source/connect',async(request,reply)=>{empty.parse(request.body);bounded(request);const result=await secondary().begin(sessions.get(request)!);reply.setCookie(calendarBindingCookie,result.browserBinding,cookie);return {authorization_url:result.authorization_url};});
 app.post('/api/microsoft/calendar-source/finish',async(request,reply)=>{empty.parse(request.body);bounded(request);try{return await secondary().finish(sessions.get(request)!,request.cookies[calendarBindingCookie]);}finally{reply.clearCookie(calendarBindingCookie,cookie);}});
 app.get('/api/microsoft/calendar-source/resources',async request=>{bounded(request);return secondary().resources(sessions.get(request)!);});
 app.post('/api/microsoft/calendar-source/selection',async request=>{bounded(request);return secondary().select(sessions.get(request)!,microsoftCalendarSelectionSchema.parse(request.body));});
 app.get('/api/microsoft/calendar-source/context',async request=>{bounded(request);const result=await secondary().calendarContext(sessions.get(request)!,microsoftReadRangeSchema.parse(request.query));const status=await secondary().status(sessions.get(request)!);return {...result,mail_folders:[],model_disclosure_enabled:status.model_disclosure_enabled};});
 app.post('/api/microsoft/calendar-source/disconnect',async(request,reply)=>{empty.parse(request.body);bounded(request);const result=await secondary().disconnect(sessions.get(request)!);reply.clearCookie(calendarBindingCookie,cookie);return result;});
}
