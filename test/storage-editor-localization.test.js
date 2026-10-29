import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {storageUI} from '../src/web/storage-ui.js';
import {storageMap} from '../src/locations.js';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {validateCatalogue} from '../src/web/i18n/runtime.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const catalogue=locale=>readFile(new URL('../src/web/locales/'+locale+'/workspaceSecurity.json',import.meta.url),'utf8').then(JSON.parse);
test('storage display translates server labels and review counts without changing paths or request values',async context=>{
 const previous=globalThis.document;globalThis.document={querySelector:()=>null};
 context.after(()=>{globalThis.document=previous;activateLanguage('en');});
 const source=storageMap('C:/Authored <workspace>',null),descriptor=storageMap(source.root,null,undefined,{catalogue:true}).locations[0];
 source.locations.push(descriptor,{label:'Custom <label>',path:'C:/User <path>'});
 const state={book:{title:'User workspace'},storageBusy:false,dirty:false,storage:{...source,applicationRoot:'C:/Application <path>',database:{ready:true,message:'PostgreSQL is connected.',placement:'workspace',path:'C:/Database <path>'}},access:{encrypted:true,version:3,deviceAvailable:false,passwordAvailable:true,username:'User <name>'}};
 const original=structuredClone(state.storage),calls=[];let dialog='';
 const ui=storageUI({state,api:async(path,data)=>{calls.push({path,data});assert.equal(path,'/api/storage/copy/preview');return {destination:data.path,files:1,bytes:1048576};},activity:{storageBusy:()=>false},writerRecovery:{},esc,field:(label,control)=>'<label>'+label+'</label>'+control,save:async()=>{},render:()=>{},showDialog:value=>{dialog=value;},notify:()=>{},reload:()=>{},resetInterface:()=>{},isUploading:()=>false});
 const english=await catalogue('en');
 for(const locale of ['en','ca','es','nb','nn']){
  const messages=await catalogue(locale);assert.deepEqual(Object.keys(messages).sort(),Object.keys(english).sort());validateCatalogue(messages,english);
  await prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(locale);
  const html=ui.view();
  for(const key of Object.keys(english).filter(key=>key.startsWith('location')))assert.ok(html.includes(esc(messages[key])),locale+': '+key);
  assert.ok(html.includes('Custom &lt;label&gt;'));assert.ok(html.includes('C:/User &lt;path&gt;'));
  assert.ok(html.includes(esc(messages.databaseConnected)));assert.ok(!html.includes('<path>'));
  assert.deepEqual(state.storage,original);
  state.storage.database.ready=false;state.storage.database.code='DATABASE_UNAVAILABLE';
  assert.ok(ui.view().includes(esc(t('errors','DATABASE_UNAVAILABLE'))));state.storage.database=structuredClone(original.database);
  await ui.action({dataset:{action:'storage-encrypt-dialog'}});
  assert.ok(dialog.includes(esc(messages.encryptHelp)));assert.ok(dialog.includes('name="confirmPassword"'));
  const review={innerHTML:''},submit={textContent:''},form={id:'storage-encrypt-form',dataset:{},elements:{storagePath:{value:''}},querySelector:selector=>selector==='[data-encryption-review]'?review:submit};
  await ui.submit(form,new Map([['storagePath','C:/New <folder>'],['password',''],['confirmPassword','']]));
  assert.ok(review.innerHTML.includes(esc(t('workspaceSecurity','encryptReady',{count:1,megabytes:'1.00'}))));
  assert.equal(form.elements.storagePath.value,'C:/New <folder>');assert.equal(submit.textContent,messages.encryptUse);
  assert.deepEqual(calls.at(-1),{path:'/api/storage/copy/preview',data:{path:'C:/New <folder>'}});
 }
});
