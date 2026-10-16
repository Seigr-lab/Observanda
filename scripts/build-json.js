import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('src/web/vendor',{recursive:true});
// The browser always uses TextDecoder. Disable the dependency's optional Node
// acceleration detection so no Node polyfill or dynamic import is shipped.
await build({entryPoints:['src/json/browser-parser.js'],outfile:'src/web/vendor/json-parser.js',bundle:true,platform:'browser',format:'esm',target:['es2022'],define:{process:'undefined'},supported:{'template-literal':false},minify:true,legalComments:'none'});
await writeFile('src/web/vendor/json-parser-LICENSE.txt',(await Promise.all(['stream-json','stream-chain'].map(async name=>name+'\n'+await readFile('node_modules/'+name+'/LICENSE','utf8')))).join('\n\n'));
