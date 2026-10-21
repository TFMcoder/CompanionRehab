import {readFile} from 'node:fs/promises';
import {createDecipheriv} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {join} from 'node:path';
import {ownerTestDirectory,ownerTestSchema} from '../src/server/owner-test-config.js';
if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Open the private test login window interactively; do not pipe or capture credentials.');
const settings=ownerTestSchema.parse(JSON.parse(await readFile(join(ownerTestDirectory,'config.json'),'utf8')));
const bytes=Buffer.from(await readFile(join(ownerTestDirectory,'login.enc'),'utf8'),'base64url');
const decipher=createDecipheriv('aes-256-gcm',Buffer.from(settings.session_key,'base64'),bytes.subarray(0,12));decipher.setAAD(Buffer.from('nancy-owner-test-login-v1'));decipher.setAuthTag(bytes.subarray(12,28));
const login=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
const rl=createInterface({input:process.stdin,output:process.stdout});
try{console.clear();console.log(`NANCY TEST LOGIN — PRIVATE\n\nTest website: ${login.origin}\nEmail: ${login.email}\nPassword: ${login.password}\n\nPractice data only. This is separate from the live account.\n`);await rl.question('Press Enter to clear and close.');}finally{console.clear();rl.close();}
