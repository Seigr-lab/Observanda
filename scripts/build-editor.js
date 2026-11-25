import {build} from 'esbuild';
import {editorBundles} from './editor-bundles.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('src/web/vendor',{recursive:true});
await build(editorBundles[0]);
await writeFile('src/web/vendor/equations-LICENSE.txt',await readFile('node_modules/katex/LICENSE'));
await build(editorBundles[1]);
const modules=['prosemirror-model','prosemirror-state','prosemirror-view','prosemirror-transform','prosemirror-commands','prosemirror-history','prosemirror-keymap','prosemirror-schema-list','prosemirror-collab','orderedmap','rope-sequence','w3c-keyname'];
await writeFile('src/web/vendor/rich-text-LICENSE.txt',(await Promise.all(modules.map(async name=>name+'\n'+await readFile('node_modules/'+name+'/LICENSE','utf8')))).join('\n\n'));
