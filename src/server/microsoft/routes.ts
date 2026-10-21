import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {ApiError} from '../errors.js';
import type {Session} from '../session.js';
import type {MicrosoftService} from './service.js';
import {microsoftReadRangeSchema,microsoftSelectionSchema,microsoftUnavailable,microsoftPrepareSchema,microsoftConfirmSchema} from '../../shared/microsoft-contracts.js';

export const microsoftCallbackPath='/api/microsoft/callback';
export function registerMicrosoftRoutes(app:FastifyInstance,options:{service?:MicrosoftService;sessions:WeakMap<FastifyRequest,Session>;origin:string;bindingCookieName?:'nancy_microsoft_binding'|'nancy_test_microsoft_binding';limit:(request:FastifyRequest,key:string,maximum:number)=>void}){
 const {sessions,origin,limit}=options;
 const service=()=>{if(!options.service)throw new ApiError(503,'microsoft_not_configured','The Outlook connection is not available yet.');return options.service;};
 const bindingCookie=options.bindingCookieName??'nancy_microsoft_binding';
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
  try{
   const query=z.object({state:z.string().min(1).max(512),code:z.string().min(1).max(16000).optional(),error:z.string().max(256).optional(),error_description:z.string().max(4096).optional(),error_uri:z.string().max(2048).optional(),session_state:z.string().max(512).optional()}).strict().parse(request.query);
   await service().callback(query,request.cookies[bindingCookie]);
   return reply.code(303).redirect('/?microsoft=finish');
  }catch{return reply.clearCookie(bindingCookie,cookie).code(303).redirect('/?microsoft=failed');}
 });
 app.post('/api/microsoft/finish',async(request,reply)=>{
  empty.parse(request.body);bounded(request);
  try{return await service().finish(sessions.get(request)!,request.cookies[bindingCookie]);}
  finally{reply.clearCookie(bindingCookie,cookie);}
 });
 app.get('/api/microsoft/resources',async request=>{bounded(request);return service().resources(sessions.get(request)!);});
 app.post('/api/microsoft/selection',async request=>{bounded(request);return service().select(sessions.get(request)!,microsoftSelectionSchema.parse(request.body));});
 app.get('/api/microsoft/context',async request=>{bounded(request);return service().read(sessions.get(request)!,microsoftReadRangeSchema.parse(request.query));});
 app.get('/api/microsoft/calendar',async request=>{bounded(request);return service().calendarContext(sessions.get(request)!,microsoftReadRangeSchema.parse(request.query));});
 app.post('/api/microsoft/actions/prepare',async request=>{bounded(request);return service().prepareAction(sessions.get(request)!,microsoftPrepareSchema.parse(request.body));});
 app.post('/api/microsoft/actions/confirm',async request=>{bounded(request);return service().confirmAction(sessions.get(request)!,microsoftConfirmSchema.parse(request.body));});
 app.get('/api/microsoft/actions',async request=>{bounded(request);return service().recentActions(sessions.get(request)!);});
 app.get('/api/microsoft/actions/:id',async request=>{bounded(request);const {id}=z.object({id:z.uuid()}).parse(request.params);return service().actionReceipt(sessions.get(request)!,id,true);});
 app.get('/api/microsoft/actions/:id/review',async request=>{bounded(request);const {id}=z.object({id:z.uuid()}).parse(request.params);return service().actionReview(sessions.get(request)!,id);});
 app.post('/api/microsoft/disconnect',async(request,reply)=>{empty.parse(request.body);bounded(request);const result=await service().disconnect(sessions.get(request)!);reply.clearCookie(bindingCookie,cookie);return result;});
}
