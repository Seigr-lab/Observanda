import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {editorBundles} from '../scripts/editor-bundles.js';

// The editor bundles are generated files that ship with the app. They embed the
// English texts and share the app's text registry, so a bundle left behind by a
// source or text change would bring old texts back at run time.
for(const options of editorBundles){
 test(options.outfile+' is built from the current sources and texts',async()=>{
  const result=await build({...options,write:false});
  const fresh=result.outputFiles[0].text,shipped=await readFile(options.outfile,'utf8');
  assert.ok(fresh===shipped,options.outfile+' is out of date: run node scripts/build-editor.js');
 });
}
