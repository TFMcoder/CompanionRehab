import {microsoftMailSearchSchema,type MicrosoftMailSearch} from '../../shared/microsoft-contracts.js';

/** Literal terms only. The model never supplies KQL, a URL, folder or account. */
export function mailSearchQuery(input:MicrosoftMailSearch,now:Date){
 const value=microsoftMailSearchSchema.parse(input),range={start:new Date(value.start??now.getTime()-90*86400000).toISOString(),end:new Date(value.end??now.getTime()).toISOString()};
 const start=range.start.slice(0,10),endDate=new Date(range.end),midnight=endDate.toISOString().endsWith('T00:00:00.000Z');
 if(!midnight)endDate.setUTCDate(endDate.getUTCDate()+1);
 const terms=value.query?.match(/[\p{L}\p{N}]+/gu)??[];
 if(terms.length>20)throw Error('Use at most twenty search words.');
 const clauses=[`received>=${start}`,`received<${endDate.toISOString().slice(0,10)}`,
  ...terms.map(term=>`"${term}"`),...(value.from?[`from:"${value.from}"`]:[])];
 return {query:value,range,expression:JSON.stringify(clauses.join(' AND '))};
}
export function isMailSearchRequest(text:string){return /\b(emails?|messages?|inbox|mail)\b/i.test(text)&&(/\b(search|find|look for|older|before|last month|last year|past|historical|\d{4}-\d{2}-\d{2})\b/i.test(text)||/\bmy (?:email|mail|inbox) history\b/i.test(text));}
