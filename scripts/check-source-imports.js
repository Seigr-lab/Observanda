import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Application modules must be runnable from the packaged source tree alone.
// Dependencies supplied by package.json remain external to this graph check.
export async function checkSourceImports(){
 const root=fileURLToPath(new URL('..',import.meta.url)),source=path.join(root,'src');
 const graphs=[];
 for(const entry of ['src/server.js','src/cli.js','src/desktop-service.js','src/web/app.js']){
  const result=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,packages:'external',platform:entry.includes('/web/')?'browser':'node',format:'esm',write:false,metafile:true,logLevel:'silent'});
  for(const input of Object.keys(result.metafile.inputs)){
   const relative=path.relative(source,path.resolve(root,input));
   assert.ok(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'Application import outside packaged source: '+input);
  }
  graphs.push({entry,modules:Object.keys(result.metafile.inputs).length});
 }
 return graphs;
}
