import {build} from 'vite';
import {resolve} from 'node:path';
const out=resolve('.local/safari-voice-2026-10-23/build');
await build({configFile:false,build:{outDir:out,emptyOutDir:true,rollupOptions:{input:'safari-test.html'}}});
console.log('Built the separate owner phone-study page; production assets were not written.');
