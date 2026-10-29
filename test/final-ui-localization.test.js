import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {loadWorkspaceView} from '../src/web/workspace-load-ui.js';
import {moduleWorkbench} from '../src/web/module-workbench.js';
import {moduleLabel,moduleLocationLabel} from '../src/web/module-presentation.js';
import {FEATURE_MODULES} from '../src/web/feature-modules.js';
import {lazyFeatureUI} from '../src/web/lazy-feature-ui.js';
import {insertCanvasSections} from '../src/web/website-canvas-insert.js';
import {newElement} from '../src/web/composition-tree.js';
const locales=['en','ca','es','nb','nn'];
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function loadingDocument(context){
 const previous=globalThis.document,nodes=new Map();const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,textContent:'',focus(){this.focused=true;}});return nodes.get(selector);};
 globalThis.document={querySelector:()=>({querySelector:node})};context.after(()=>{globalThis.document=previous;activateLanguage('en');});return node;
}
test('workspace loading localizes progress, cancellation and resumption without returning a partial workspace',async context=>{
 const node=loadingDocument(context);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);let calls=0,html='',resolved=false;const result={book:{id:'complete'}},reader={reset(){assert.fail('A resumable read keeps its pages');},read:({signal,onProgress})=>{
   if(++calls===1){onProgress({loaded:1,total:2});return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));}return Promise.resolve(result);
  }};
  const pending=loadWorkspaceView({reader,show:value=>{html=value;}});pending.then(()=>{resolved=true;});
  for(const key of ['workspaceOpening','workspaceRecords','workspaceCancel','workspaceRetry','workspaceReload'])assert.ok(html.includes(esc(t('startup',key))));
  assert.equal(node('#workspace-load-progress').textContent,t('startup','workspaceProgress',{count:2,loaded:1,total:2}));
  node('#workspace-load-cancel').onclick();await tick();assert.equal(resolved,false);
  assert.equal(node('#workspace-load-retry').textContent,t('startup','workspaceResume'));
  assert.equal(node('#workspace-load-progress').textContent,t('startup','workspacePaused')+' '+t('startup','workspaceReceived',{count:2,loaded:1,total:2}));
  await node('#workspace-load-retry').onclick();assert.equal(await pending,result);assert.equal(calls,2);
 }
});
test('workspace loading translates known failure codes and preserves unknown detail text',async context=>{
 const node=loadingDocument(context);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);let fail=true,known=true;
  const reader={reset(){},read:async()=>{if(fail)throw known?{code:'PUBLISH_REMOTE',message:'English fallback'}:{message:'Authored <diagnostic>'};return 'complete';}};
  let pending=loadWorkspaceView({reader,show(){}});await tick();assert.equal(node('#workspace-load-error').textContent,t('errors','PUBLISH_REMOTE'));
  fail=false;await node('#workspace-load-retry').onclick();assert.equal(await pending,'complete');
  known=false;fail=true;pending=loadWorkspaceView({reader,show(){}});await tick();assert.equal(node('#workspace-load-error').textContent,'Authored <diagnostic>');
  fail=false;await node('#workspace-load-retry').onclick();await pending;
 }
});
test('disabled and unavailable module shells use current labels without changing feature configuration',async context=>{
 context.after(()=>activateLanguage('en'));
 const state={book:{id:'workspace',projects:[{id:'project',title:'Authored <project>',tools:[]}]},storage:{contextId:'context'},moduleId:'planning',modulePath:'scope/project/agenda',dashboardSettings:{enabledModules:[]}},before=structuredClone(state);
 const ui=moduleWorkbench({state,esc,render(){},api:async()=>{assert.fail('No request for a disabled module');}}),module=FEATURE_MODULES.find(item=>item.id==='planning');
 for(const locale of locales){
  await load(locale);activateLanguage(locale);let html=ui.view();assert.ok(html.includes(esc(moduleLabel(module))));assert.ok(html.includes(esc(t('supportEditors','moduleEnable'))));
  state.dashboardSettings.enabledModules=['planning'];html=ui.view();assert.ok(html.includes(esc(moduleLocationLabel(module))));assert.ok(html.includes(esc(t('supportEditors','moduleProjectUnavailable'))));
  state.modulePath='';html=ui.view();assert.ok(html.includes(esc(t('supportEditors','moduleNoScreen'))));
  state.moduleId='unknown';html=ui.view();assert.ok(html.includes(esc(t('supportEditors','moduleUnavailable'))));
  state.moduleId=before.moduleId;state.modulePath=before.modulePath;state.dashboardSettings.enabledModules=[];assert.deepEqual(state,before);
 }
});
test('lazy module loading and disabled errors translate before module code is loaded',async context=>{
 context.after(()=>activateLanguage('en'));const ui=lazyFeatureUI({enabled:()=>false,handles:()=>true,load:async()=>{assert.fail('Disabled module must not load');}});
 for(const locale of locales){await load(locale);activateLanguage(locale);assert.equal(ui.view(),'<p>'+esc(t('supportEditors','moduleOpening'))+'</p>');await assert.rejects(ui.ready(),{message:t('supportEditors','moduleEnableFirst')});}
});
test('temporary canvas preview uses a localized message and keeps authored section data',async context=>{
 context.after(()=>activateLanguage('en'));const section={...newElement('asset'),title:'Authored <title>'},before=structuredClone(section);let html='';
 const root={querySelector:()=>null,querySelectorAll:()=>[],append(){},ownerDocument:{createElement:()=>({set innerHTML(value){html=value;},content:{}})}};
 for(const locale of locales){await load(locale);activateLanguage(locale);assert.equal(insertCanvasSections(root,[section],[section],{esc}),true);assert.ok(html.includes(esc(t('websiteAuthoring','editorPreparingPreview'))));assert.ok(html.includes(esc(section.title)));assert.deepEqual(section,before);}
});
