import './asana-test.css';
type Task={remote_id:string;version:string;source:{title:string;completed:boolean;due_on:string|null;due_at:string|null;section:string|null};missing:boolean;observed_at:string;local_task_id:string|null;imported_version:string|null};
const root=document.querySelector<HTMLDivElement>('#asana-root')!;
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
const banner=el('header'),home=el('a','Talk to Nancy');home.href='/';banner.append(home);root.append(banner);
const main=el('main');main.append(el('h1','Asana sandbox'),el('p','Nancy Test — practice data only. This reads the selected synthetic project. Imported tasks wait for your review.'));
const notice=el('p');notice.setAttribute('role','status');main.append(notice);root.append(main);
let busy=false;
async function api(path:string,body?:unknown){const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();
 if(!response.ok){if(response.status===401||response.status===403)login();throw Error(result.error?.message??'That request could not finish. Refresh before retrying a save.');}return result;}
function button(label:string,action:()=>Promise<unknown>){const b=el('button',label);b.type='button';b.onclick=async()=>{if(busy)return;busy=true;document.querySelectorAll('button').forEach(x=>x.disabled=true);try{await action();}catch(error){notice.textContent=(error as Error).message;}finally{busy=false;document.querySelectorAll('button').forEach(x=>x.disabled=false);}};return b;}
const controls=el('section'),list=el('section');main.append(controls,list);
function login(){controls.replaceChildren();list.replaceChildren();const form=el('form'),title=el('h2','Sign in to your Nancy test copy');form.append(title);
 const email=el('input'),password=el('input');email.type='email';email.value='tester@nancy.local';email.autocomplete='username';password.type='password';password.autocomplete='current-password';
 for(const[label,input]of [['Email',email],['Password',password]]as const){const l=el('label',label);l.append(input);form.append(l);}
 const submit=el('button','Sign in');submit.type='submit';form.append(submit);form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await api('/api/auth/login',{email:email.value,password:password.value,remember_device:true});password.value='';await refresh();}catch(error){notice.textContent=(error as Error).message;}finally{submit.disabled=false;}};controls.append(form);
}
async function refresh(message?:string){const data=await api('/api/asana-test') as {connected:boolean;tasks:Task[]};controls.replaceChildren();list.replaceChildren();
 if(!data.connected){notice.textContent=message??'Connect your sandbox to begin.';controls.append(button('Connect Asana sandbox',async()=>{const r=await api('/api/asana-test/connect',{});location.assign(r.authorization_url);}));return;}
 notice.textContent=message??'Connected to Daily Life - Sandbox. Read-only access.';
 controls.append(button('Import latest tasks',async()=>{const r=await api('/api/asana-test/sync',{});await refresh(`${r.received} tasks read: ${r.added} new, ${r.changed} changed. Review below.`);}),button('Disconnect sandbox',async()=>{await api('/api/asana-test/disconnect',{});await refresh('Disconnected. Previously added Nancy tasks are retained.');}));
 list.append(el('h2',`${data.tasks.length} source tasks`),el('p','Adding a task makes it available for planning. It does not accept a day plan, report an activity, or change Asana. A date without a time stays a date only.'));
 for(const t of data.tasks){const article=el('article');article.append(el('h3',t.source.title),el('p',`${t.source.due_at?new Date(t.source.due_at).toLocaleString():t.source.due_on??'No date'} · ${t.source.section??'No section'}`),el('p',`Source ID: ${t.remote_id}`));
  const state=t.missing?'Removed from selected project — review needed':t.source.completed?'Completed in Asana — no Nancy activity report':t.local_task_id?t.imported_version===t.version?'Available for planning in Nancy':'Asana changed — Nancy task retained for separate review':'Waiting for your review';article.append(el('p',state));
  article.append(el('small',`Last read: ${new Date(t.observed_at).toLocaleString()}`));
  if(!t.missing&&!t.source.completed&&!t.local_task_id){const commandId=crypto.randomUUID();article.append(button('Add to my available tasks',async()=>{await api('/api/asana-test/accept',{command_id:commandId,remote_id:t.remote_id,version:t.version});await refresh('Task added to your practice planning choices.');}));}
  list.append(article);
 }
}
const query=new URLSearchParams(location.search);history.replaceState(null,'',location.pathname);
async function start(){try{if(query.has('finish'))await api('/api/asana-test/finish',{});await refresh(query.has('failed')?'The Asana connection was not completed. Try Connect again.':undefined);}catch(error){notice.textContent=(error as Error).message;}}
void start();
