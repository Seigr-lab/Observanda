import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {researchMaterialsUI} from '../src/web/research-materials-ui.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const locales=['en','ca','es','nb','nn'];

// Rendering and mocked read requests only. Browser suites exercise the actual DOM.
test('material dataset and unfinished-selection views translate without changing retained data or references',async context=>{
 const previous={document:globalThis.document,window:globalThis.window,ResizeObserver:globalThis.ResizeObserver};
 const dialog={open:true,addEventListener(){},querySelector(){return null;}},form={isConnected:true,querySelectorAll(){return [];}};
 const documentElement={lang:'en'};
 globalThis.document={documentElement,getElementById:id=>id==='dialog'?dialog:id==='material-form'?form:null,querySelectorAll:()=>[],querySelector:()=>null};
 globalThis.window={addEventListener(){}};globalThis.ResizeObserver=class{disconnect(){}unobserve(){}};
 context.after(()=>{Object.assign(globalThis,previous);activateLanguage('en');});
 const workspaceId=randomUUID(),recordId=randomUUID(),sourceId=randomUUID(),revision='a'.repeat(64),authored='<img src=x> & 105₆';
 const state={page:'record-reader',selected:recordId,storage:{contextId:randomUUID()},book:{id:workspaceId,entries:[{id:recordId,title:authored}]}};
 const reference={kind:'dataset',id:sourceId,revision,workspaceId};
 const document={kind:'dataset',id:sourceId,recordId,title:authored,content:{pageIndex:{count:1},schemaIndex:{count:1},sourceMapping:{format:'delimited',fields:[]}}};
 // The dataset view reads one window of its table: the rows and the definitions of the shown columns.
 const rows={rows:[{page:0,index:0,ordinal:0,id:'row-1',order:1,line:2,cells:['105'],valueKinds:['value']}],columns:[{index:0,definition:{name:authored,representation:'radix',radix:6,unit:'m',computation:{version:1,kind:'approximate-inputs'}}}],offset:0,total:1,width:1,sourceRows:1,revision};
 const draft={id:randomUUID(),state:'open',kind:'collection',title:authored,received:{inputs:1,outputs:0},totals:{inputs:2,outputs:0},method:{tool:authored,version:'1',parameters:authored}};
 const saved=structuredClone({document,rows,draft,state}),calls=[];let html='';
 const api=async(path,data)=>{calls.push({path,data:structuredClone(data)});const name=path.split('/').at(-1),value=name==='read'?document:name==='table-browse'?rows:name==='draft-read'?draft:null;assert.ok(value,'Unexpected request '+path);return path.includes('/material-reference/')?{namespaceId:workspaceId,projectId:null,value}:value;};
 const ui=researchMaterialsUI({state,api,esc,field:(label,input)=>'<label>'+label+input+'</label>',showDialog:value=>{html=value;},notify(){},dirty(){},render(){},revisions:()=>({[recordId]:revision}),create(){}});
 for(const locale of locales){
  await load(locale);activateLanguage(locale);documentElement.lang=locale;await ui.openReference(reference);
  assert.ok(html.includes('aria-label="'+esc(t('materialEditors','datasetValues'))+'"'));
  assert.ok(html.includes(esc(t('datasetTable','range',{first:'1',last:'1',total:'1',source:'1'}))));
  assert.ok(html.includes(esc(t('measurements','radixLabel'))));
  assert.ok(html.includes(esc(t('measurements','computationApproximateInputs'))));
  assert.ok(html.includes(esc(authored)));assert.ok(!html.includes('<img src=x>'));assert.ok(!html.includes('&amp;lt;'));
  assert.ok(html.includes('>105</span></button>'));assert.ok(html.includes(esc(revision))||html.includes('&quot;revision&quot;'));
  await ui.action({dataset:{action:'material-draft-open',id:draft.id}});
  assert.ok(html.includes(esc(t('materialEditors','unfinishedKind',{kind:t('materialEditors','draftKindCollection')}))));
  assert.ok(html.includes(esc(t('materialEditors','receivedReferences',{received:1,total:2}))));
  assert.ok(html.includes(esc(t('materialEditors','chooseRemaining',{slot:t('materialEditors','slotInputs')}))));
  assert.ok(!html.includes('${esc('));assert.ok(!html.includes("'+esc("));assert.ok(!html.includes('<img src=x>'));
  assert.deepEqual({document,rows,draft,state},saved);
 }
 assert.ok(calls.every(({path})=>['read','table-browse','draft-read'].includes(path.split('/').at(-1))));
});
