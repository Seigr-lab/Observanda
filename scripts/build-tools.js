import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('src/web/vendor',{recursive:true});
await build({entryPoints:['src/tools/worker.js'],outfile:'src/web/vendor/tools-worker.js',bundle:true,platform:'browser',format:'esm',target:['es2022'],minify:true,legalComments:'linked'});
const names=['mathjs','openchemlib','saxes','xmlchars','@babel/runtime','complex.js','decimal.js','escape-latex','fraction.js','javascript-natural-sort','seedrandom','tiny-emitter','typed-function'];
const licenses=[];for(const name of names){let text;for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','LICENCE','LICENSE.MIT','LICENCE.md'])try{text=await readFile('node_modules/'+name+'/'+file,'utf8');break;}catch{}if(!text&&name==='seedrandom')text=await readFile('node_modules/seedrandom/seedrandom.js','utf8');if(!text&&name==='javascript-natural-sort')text=await readFile('node_modules/'+name+'/naturalSort.js','utf8');if(!text)try{text=await readFile('src/tools/licenses/'+name+'.txt','utf8');}catch{}if(!text)throw Error('License missing for '+name);licenses.push(name+'\n'+text);}
await writeFile('src/web/vendor/tools-LICENSE.txt',licenses.join('\n\n'));
