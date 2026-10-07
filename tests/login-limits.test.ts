import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { configFromEnv } from '../src/server/config.js';
import { SessionRevocations } from '../src/server/revocations.js';
import type { CareService } from '../src/server/care-access.js';

async function fixture(proxy:boolean) {
  const config=configFromEnv({PUBLIC_ORIGIN:'https://nancy.example',DATABASE_URL:'postgresql://unused',SESSION_KEY:randomBytes(32).toString('base64'),...(proxy?{NANCY_TRUSTED_PROXY:'cloudflare-loopback'}:{})});
  const session={user_id:randomUUID(),session_id:randomUUID(),access_token:'synthetic',refresh_token:'synthetic',expires_at:Date.now()/1000+3600,issued_at:Date.now()/1000};
  const care={login:async()=>session} as unknown as CareService;
  const app=await createApp(config,{care,revocations:new SessionRevocations()});
  const login=(client:string,remoteAddress='127.0.0.1',email='audit@example.invalid')=>app.inject({method:'POST',url:'/api/auth/login',remoteAddress,
    headers:{host:'nancy.example',origin:config.origin,'cf-connecting-ip':client,'x-forwarded-for':'203.0.113.123'},payload:{email,password:'synthetic-only'}});
  return {app,login};
}
describe('login limits behind an explicitly trusted local tunnel',()=>{
  it('limits an account/client pair without blocking a different tunneled client',async()=>{
    const {app,login}=await fixture(true);
    try{
      for(let i=0;i<8;i++)expect((await login('192.0.2.1')).statusCode).toBe(200);
      expect((await login('192.0.2.1')).statusCode).toBe(429);
      expect((await login('192.0.2.2')).statusCode).toBe(200);
      expect((await login('192.0.2.1','127.0.0.1','another@example.invalid')).statusCode).toBe(200);
    }finally{await app.close();}
  });
  it.each([{proxy:false,peer:'127.0.0.1'},{proxy:true,peer:'198.51.100.5'}])('ignores forwarded identities without the trusted local ingress: %j',async({proxy,peer})=>{
    const {app,login}=await fixture(proxy);
    try{
      for(let i=0;i<8;i++)expect((await login(`192.0.2.${i+1}`,peer)).statusCode).toBe(200);
      expect((await login('192.0.2.99',peer)).statusCode).toBe(429);
    }finally{await app.close();}
  });
  it('does not accept malformed or multiple forwarded addresses as bucket identities',async()=>{
    const {app,login}=await fixture(true);
    try{
      for(let i=0;i<8;i++)expect((await login(`192.0.2.1, spoof-${i}`)).statusCode).toBe(200);
      expect((await login('not-an-ip')).statusCode).toBe(429);
    }finally{await app.close();}
  });
  it('bounds aggregate attempts even when account names rotate',async()=>{
    const {app,login}=await fixture(true);
    try{
      for(let i=0;i<20;i++)expect((await login('192.0.2.1','127.0.0.1',`audit-${i}@example.invalid`)).statusCode).toBe(200);
      expect((await login('192.0.2.1','127.0.0.1','next@example.invalid')).statusCode).toBe(429);
      expect((await login('192.0.2.2')).statusCode).toBe(200);
    }finally{await app.close();}
  });
});
