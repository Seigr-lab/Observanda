import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {BrowserAssets,createBrowserAssets} from '../src/browser-assets.js';
import {buildBrowser} from '../scripts/browser-build.js';
import {deferredCatalogues} from '../src/web/i18n/deferred.js';

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-browser-assets-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-browser-assets-'));await rm(root,{recursive:true,force:true});});return root;}
const directoryURL=directory=>pathToFileURL(directory+path.sep);
// The catalogue registry includes shell controls as well as deferred editors.
// Keep shell membership explicit so a new eager catalogue still fails this check.
const shellCatalogues=new Set(['figureDisplay','figureDiagnostics','compositionControls','dashboardEditors','websiteAuthoring','applicationTexts','workspaceSecurity','supportEditors','materialEditors','projectEditors','editorControls','moduleEditors','recordEditors','workspaceViews','githubTransfer','labBookData','repositorySetup']);

test('browser assets load on demand, coalesce reads and bound retained bytes',async t=>{
 const root=await fixture(t),source=path.join(root,'web');await mkdir(source);
 await writeFile(path.join(source,'index.html'),'<main>{{startup.opening}}</main>');await writeFile(path.join(source,'startup.js'),'void messages;');await writeFile(path.join(source,'feature.js'),'export const value=1;');
 const assets=await createBrowserAssets({directory:directoryURL(source),builtDirectory:directoryURL(path.join(root,'absent'))});assert.equal(assets.statistics().reads,2);
 const before=assets.statistics().reads;const values=await Promise.all(Array.from({length:30},()=>assets.response('feature.js')));assert.equal(assets.statistics().reads,before+1);assert.equal(values[0].cacheControl,'no-store');assert.equal(values[0].etag,null);
 await assert.rejects(assets.read('../secret'),{code:'NOT_FOUND'});
 const limited=new BrowserAssets({cacheBytes:12,cacheEntries:2});for(let i=0;i<10;i++){const file=path.join(root,i+'.js');await writeFile(file,'123456');limited.file(i,pathToFileURL(file));await limited.read(i);}
 assert.equal(limited.statistics().cacheBytes,12);assert.equal(limited.statistics().cached,2);
});

test('cold module and catalogue bursts queue bounded reads and recover after an invalid asset',async t=>{
 const root=await fixture(t),assets=new BrowserAssets({cacheBytes:48,cacheEntries:8});
 for(let i=0;i<48;i++){
  const file=path.join(root,i+'.js');await writeFile(file,'123456');
  assets.file(String(i),pathToFileURL(file),i===17?{size:99}:{});
 }
 const requests=Array.from({length:48},(_,i)=>assets.read(String(i))),duplicates=Array.from({length:12},()=>assets.read('47'));
 assert.equal(assets.statistics().active,16);assert.equal(assets.statistics().queued,32);assert.equal(assets.statistics().pending,48);
 const outcomes=await Promise.allSettled([...requests,...duplicates]);
 assert.deepEqual(outcomes.filter(row=>row.status==='rejected').map(row=>row.reason.code),['BROWSER_ASSETS_INVALID']);
 assert.equal(assets.statistics().reads,47,'Queued duplicates share the same disk read');
 assert.equal(assets.statistics().pending,0);assert.equal(assets.statistics().active,0);assert.equal(assets.statistics().queued,0);assert.ok(assets.statistics().cacheBytes<=48);assert.ok(assets.statistics().cached<=8);
 assets.file('17',pathToFileURL(path.join(root,'17.js')));
 assert.equal((await assets.read('17')).toString(),'123456');
});

test('production browser chunks are content addressed and reject corrupt or unsafe package manifests',async t=>{
 const root=await fixture(t),out=path.join(root,'output'),result=await buildBrowser({out});
 const options={builtDirectory:directoryURL(out)},assets=await createBrowserAssets(options),index=(await assets.response('index.html')).bytes.toString();
 assert.ok(index.includes('/'+result.manifest.entry));assert.ok(!index.includes('src="/app.js"'));assert.ok(!index.includes('{{startup.'));assert.equal((await assets.response('index.html')).cacheControl,'no-store');
 const entry=await assets.response(result.manifest.entry);assert.match(entry.cacheControl,/immutable/);assert.match(entry.etag,/^"[a-f0-9]{64}"$/);assert.equal(entry.bytes.length,result.manifest.files.find(file=>file.path===result.manifest.entry).size);
 t.diagnostic(JSON.stringify({initialJavaScriptBytes:result.initialJavaScriptBytes,initialJavaScriptFiles:result.initialJavaScriptFiles,sourceStaticFiles:result.sourceStaticFiles,javascriptFiles:result.javascriptFiles,stylesheetBytes:result.stylesheetBytes}));
 assert.ok(result.initialJavaScriptBytes<=2*1024*1024,'The compiled startup graph must remain within its 2 MiB uncompressed JavaScript budget');
 assert.ok(result.initialJavaScriptFiles<result.sourceStaticFiles,'Bundling must reduce the actual source-module request graph');assert.ok(result.javascriptFiles>result.initialJavaScriptFiles,'Feature entry chunks must stay deferred');
 for(const feature of ['research-materials-ui.js','publishing-ui.js','laboratory-ui.js','reviews-ui.js','publication-jobs-ui.js','publication-selection-ui.js','record-values-ui.js','record-writing-ui.js','record-draft-edit-ui.js','retained-figure-editor.js','figure-editor.js'])assert.ok(!result.initialSources.includes('src/web/'+feature),feature+' must remain outside the startup graph');
 for(const namespace of Object.keys(deferredCatalogues))assert.equal(result.initialSources.includes('src/web/locales/en/'+namespace+'.json'),shellCatalogues.has(namespace),namespace+' must retain its shell or deferred owner boundary');
 assert.deepEqual(result.editorSources,['src/editor/equations.js','src/editor/rich-text-editor.js']);
 for(const entry of result.editorSources)assert.ok(!result.initialSources.includes(entry),'Authoring engines load on demand');
 const styles=result.manifest.files.find(file=>file.path.endsWith('.css'));assert.ok(!(await assets.read(styles.path)).toString().includes('@import'),'The packaged stylesheet must not preserve a source CSS waterfall');
 assert.equal((index.match(/data-document-styles/g)??[]).length,1);assert.ok(index.includes('href="/'+styles.path+'" data-document-styles'));assert.ok((await assets.read(styles.path)).toString().includes('.ProseMirror'),'Compiled assets retain document editor styling');
 const file=path.join(out,result.manifest.entry),original=await readFile(file);await writeFile(file,Buffer.alloc(original.length,32));
 const corrupted=await createBrowserAssets(options);await assert.rejects(corrupted.read(result.manifest.entry),{code:'BROWSER_ASSETS_INVALID'});await writeFile(file,original);
 for(const bad of [null,false,{...result.manifest,entry:'../outside.js'},{...result.manifest,files:[...result.manifest.files,{path:'../outside.js',size:1,sha256:'0'.repeat(64)}]},{...result.manifest,files:[...result.manifest.files,result.manifest.files[0]]}]){
  await writeFile(path.join(out,'manifest.json'),JSON.stringify(bad));await assert.rejects(createBrowserAssets(options),{code:'BROWSER_ASSETS_INVALID'});
 }
});
