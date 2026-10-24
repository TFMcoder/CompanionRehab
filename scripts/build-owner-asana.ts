import {build} from 'vite';
import {resolve} from 'node:path';
await build({configFile:false,build:{outDir:resolve('.local/asana-integration-2026-10-24/build'),emptyOutDir:true,rollupOptions:{input:'asana-test.html'}}});
console.log('Built separate owner Asana review page. Live client assets were not written.');
