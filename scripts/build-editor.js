import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('src/web/vendor',{recursive:true});
await build({entryPoints:['src/editor/equations.js'],bundle:true,format:'esm',platform:'browser',target:['es2022'],outfile:'src/web/vendor/equations.js',minify:true,legalComments:'none'});
await writeFile('src/web/vendor/equations-LICENSE.txt',await readFile('node_modules/katex/LICENSE'));
await build({entryPoints:['src/editor/rich-text-editor.js'],bundle:true,format:'esm',platform:'browser',target:['es2022'],outfile:'src/web/vendor/rich-text-editor.js',minify:true,legalComments:'none',plugins:[{name:'shared-runtime',setup(build){build.onResolve({filter:/^\.\/vendor\/equations\.js$/},()=>({path:'./equations.js',external:true}));build.onResolve({filter:/\/i18n\/index\.js$/},()=>({path:'../i18n/index.js',external:true}));}}]});
const modules=['prosemirror-model','prosemirror-state','prosemirror-view','prosemirror-transform','prosemirror-commands','prosemirror-history','prosemirror-keymap','prosemirror-schema-list','prosemirror-collab','orderedmap','rope-sequence','w3c-keyname'];
await writeFile('src/web/vendor/rich-text-LICENSE.txt',(await Promise.all(modules.map(async name=>name+'\n'+await readFile('node_modules/'+name+'/LICENSE','utf8')))).join('\n\n'));
