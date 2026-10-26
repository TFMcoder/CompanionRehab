/** Verification is not deployment: never replace the active dist/client assets. */
import {build} from 'vite';
import {resolve} from 'node:path';

const workspace=resolve('.');
const output=resolve(workspace,'.local/check-build');
if(!output.startsWith(workspace+'\\')&&!output.startsWith(workspace+'/'))throw Error('Verification output must remain in the workspace.');
await build({configLoader:'runner',build:{outDir:output,emptyOutDir:true}});
console.log('Verification build completed in .local/check-build. Active client assets were not published.');
