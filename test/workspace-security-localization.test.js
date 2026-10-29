import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseFragment} from 'parse5';
import {securityUI} from '../src/web/security-ui.js';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const nodes=node=>[node,...(node.childNodes??[]).flatMap(nodes)];
const attributes=(html,key)=>nodes(parseFragment(html)).flatMap(node=>(node.attrs??[]).filter(a=>a.name===key).map(a=>a.value));

test('workspace access controls localize without altering fingerprints, grants or recovery key payloads',async context=>{
 const previousDocument=globalThis.document,dialog={addEventListener(){},querySelector:()=>({focus(){}})};
 globalThis.document={querySelector:()=>dialog};context.after(()=>{globalThis.document=previousDocument;activateLanguage('en');});
 const access={devices:[{id:'a'.repeat(64)}],recoveryAvailable:true,vaultId:'example-workspace',etag:'original'};
 const state={book:{title:'Authored <workspace>'},access:{deviceAvailable:false}},before=structuredClone(state);
 let html='',notification='',writes=0;
 const ui=securityUI({state,esc,field:(label,control)=>'<label>'+esc(label)+control+'</label>',showDialog:value=>{html=value;},notify:value=>{notification=value;},api:async(path,data)=>{assert.equal(path,'/api/security/workspace');if(data)writes++;return structuredClone(access);}});
 for(const language of ['en','nb','nn','ca','es']){
  await prepareLanguage(language,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(language);
  assert.ok(ui.panel().includes(esc(t('workspaceSecurity','manageAccess'))));
  await ui.action({dataset:{action:'security-manage'}});
  assert.ok(html.includes(esc(t('workspaceSecurity','deviceCount',{count:1}))));
  assert.ok(html.includes('Authored &lt;workspace&gt;'));assert.ok(html.includes(Array(8).fill('aaaaaaaa').join(' ')));
  assert.deepEqual(attributes(html,'name'),['request','verified']);
  await ui.submit({id:'security-grant-form',elements:{request:{value:'invalid'}}},new Map([['verified','on']]));
  assert.equal(notification,t('workspaceSecurity','verifyRecipient'));assert.equal(writes,0);
  await ui.action({dataset:{action:'security-recovery-review'}});
  assert.ok(html.includes(esc(t('workspaceSecurity','oldRecovery'))));assert.ok(attributes(html,'id').includes('security-recovery-form'));
  const document=t('workspaceSecurity','recoveryDocument',{workspace:access.vaultId,key:'synthetic-recovery-key'});
  assert.ok(document.includes('\n\nsynthetic-recovery-key\n\n'));assert.ok(document.includes(access.vaultId));
  assert.deepEqual(state,before);
 }
});
