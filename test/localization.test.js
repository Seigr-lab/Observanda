import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LANGUAGES,translator,validateCatalogue,resolveLanguage} from '../src/web/i18n/runtime.js';
import {t,language,prepareLanguage,activateLanguage,prepareNamespaces,MESSAGE_NAMESPACES,catalogueLanguages,messageLanguage} from '../src/web/i18n/index.js';
import {validateGuide,searchGuide,guideLoader,guideWithMessages,mergeGuide} from '../src/web/help/model.js';
import {routeFor,resolveRoute} from '../src/web/navigation.js';
import {defaultPreferences,rememberLanguage,rememberInterface,readPreferences} from '../src/preferences.js';
import {AppError,safeError} from '../src/errors.js';
const json=async(locale,namespace)=>JSON.parse(await readFile(new URL('../src/web/locales/'+locale+'/'+namespace+'.json',import.meta.url),'utf8'));
test('all shipped language catalogues match their owner keys, parameters and guide anchors',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../src/web/locales/catalogues.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(manifest).sort(),[...MESSAGE_NAMESPACES].sort(),'Every declared owner must also be wired to the runtime loader');
 const guides=[];
 for(const locale of LANGUAGES){
  for(const namespace of MESSAGE_NAMESPACES.filter(n=>catalogueLanguages(n).includes(locale.id))){
   const base=await json('en',namespace),catalogue=await json(locale.id,namespace);
   validateCatalogue(catalogue,base);assert.deepEqual(Object.keys(catalogue).sort(),Object.keys(base).sort());
   assert.ok(Object.values(catalogue).every(value=>typeof value==='object'||value.trim()));
  }
  const guide=mergeGuide(await json('en','guide'),await json(locale.id,'guide'),locale.id);guides.push(guide.topics.map(t=>[t.id,t.sections.map(s=>s.id)]));
 }
 for(const guide of guides)assert.deepEqual(guide,guides[0]);
 assert.ok(LANGUAGES.some(l=>l.id==='nb'));assert.ok(LANGUAGES.some(l=>l.id==='nn'));
});
test('fallback, named parameters and plural messages do not reinterpret record values',()=>{
 const base={greeting:'Open {title}',count:{one:'{count} result',other:'{count} results'}};
 const tr=translator('en',{},base);
 assert.equal(tr('count',{count:1}),'1 result');assert.equal(tr('count',{count:0}),'0 results');
 assert.equal(tr('greeting',{title:'<img src=x onerror=alert(1)> 9007199254740993 / 105₆'}),'Open <img src=x onerror=alert(1)> 9007199254740993 / 105₆');
 assert.throws(()=>tr('greeting'),/parameter/);assert.throws(()=>tr('missing'),/Unknown/);
 assert.throws(()=>validateCatalogue({greeting:'Open {path}'},base),/parameters/);
 assert.throws(()=>validateCatalogue({count:{one:'one',other:'{count} results'}},base),/parameters/);
 assert.equal(resolveLanguage('nn-NO'),'nn');assert.equal(resolveLanguage('nb_NO'),'nb');assert.equal(resolveLanguage('unknown'),'en');
});
test('language loading is atomic and an interrupted resource can be retried',async()=>{
 activateLanguage('en');let count=0;
 const fetcher=async url=>{count++;if(url.pathname.endsWith('/help.json'))return {ok:false};return {ok:true,json:()=>json('ca',path.basename(url.pathname,'.json'))};};
 await assert.rejects(prepareLanguage('ca',{fetcher}));assert.equal(language(),'en');assert.equal(t('preferences','title'),'Preferences');
 await prepareLanguage('ca',{fetcher:async url=>({ok:true,json:()=>json('ca',path.basename(url.pathname,'.json'))})});
 activateLanguage('ca');assert.equal(t('preferences','title'),'Preferències');assert.equal(count,MESSAGE_NAMESPACES.filter(n=>catalogueLanguages(n).includes('ca')).length);
 assert.equal(t('access','unlock'),'Unlock workspace');assert.equal(messageLanguage('access'),'en');assert.equal(messageLanguage('help'),'ca');
 activateLanguage('en');await assert.rejects(prepareLanguage('../private'),/Unsupported/);
});
test('documentation search includes paragraphs, folds accents and keeps stable routes across languages',async()=>{
 const guide=validateGuide(await json('en','guide'));
 const result=searchGuide(guide,'nondecimal');assert.equal(result.length,1);assert.equal(result[0].topicId,'evidence');assert.match(result[0].snippet,/nondecimal/);
 assert.ok(searchGuide(await json('ca','guide'),'analisi').length>0);
 assert.deepEqual(searchGuide(guide,'definitely-no-such-topic'),[]);
 const state={page:'help',helpTopic:'records',helpSection:'history'},route=routeFor(state);
 const resolved=resolveRoute(route,{});assert.equal(resolved.page,'help');assert.equal(resolved.helpTopic,'records');assert.equal(resolved.helpSection,'history');
 assert.equal(resolveRoute('#/preferences/help/<script>',{}).page,'workspace');
 let calls=0;const load=guideLoader(async()=>{calls++;return {ok:true,json:async()=>guide};});
 assert.equal(await load('en'),guide);assert.equal(await load('en'),guide);assert.equal(calls,1);
 await assert.rejects(load('../vault'),/Unsupported/);
});

test('Help control references resolve through their owning English resources and reject stale keys',async()=>{
 await prepareNamespaces(MESSAGE_NAMESPACES);
 activateLanguage('en');const source=validateGuide(await json('en','guide'));
 const resolved=guideWithMessages(source,t),unlock=resolved.topics.find(topic=>topic.id==='storage').sections.find(section=>section.id==='unlock');
 assert.ok(unlock.paragraphs[0].includes(t('access','unlock')));assert.ok(unlock.paragraphs[0].includes(t('access','useRecovery')));
 assert.ok(!JSON.stringify(resolved).includes('{ui:'));assert.ok(JSON.stringify(source).includes('{ui:access.unlock}'));
 const renamed=guideWithMessages(source,(namespace,key)=>namespace==='access'&&key==='unlock'?'Open protected workspace':t(namespace,key));
 assert.ok(searchGuide(renamed,'Open protected workspace').length>0);
 const invalid=structuredClone(source);invalid.topics[0].sections[0].paragraphs=['{ui:access.missingControl}'];assert.throws(()=>guideWithMessages(invalid,t),/Unknown message/);
 invalid.topics[0].sections[0].paragraphs=['{ui:broken}'];assert.throws(()=>guideWithMessages(invalid,t),/Invalid guide/);
});

test('new English Help sections remain readable without inventing translations or changing their anchors',async()=>{
 const source=await json('en','guide'),translation=await json('ca','guide'),before=structuredClone(translation);
 const merged=mergeGuide(source,translation,'ca'),storage=merged.topics.find(t=>t.id==='storage');
 assert.equal(storage.language,'ca');assert.equal(storage.sections.find(s=>s.id==='unlock').language,'en');assert.equal(storage.sections.find(s=>s.id==='backup').language,'ca');
 assert.deepEqual(translation,before);assert.deepEqual(merged.topics.map(t=>[t.id,t.sections.map(s=>s.id)]),source.topics.map(t=>[t.id,t.sections.map(s=>s.id)]));
 const unknown=structuredClone(translation);unknown.topics[0].sections[0].id='unknown-control';assert.throws(()=>mergeGuide(source,unknown,'ca'),/Unknown translated guide anchor/);
});
test('language preference is independent of workspace data and preserves concurrent personal settings',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-language-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=path.join(directory,'preferences.json');
 const before=defaultPreferences();assert.equal(before.language,'en');
 await Promise.all([rememberLanguage(file,'nn'),rememberInterface(file,{fontSize:20,lineHeight:1.8})]);
 const after=await readPreferences(file);assert.equal(after.language,'nn');assert.equal(after.interface.fontSize,20);assert.deepEqual(after.dashboard,before.dashboard);assert.equal(after.workspace,null);
 await assert.rejects(rememberLanguage(file,'no'),{code:'INVALID'});assert.equal((await readPreferences(file)).language,'nn');
});
test('error messages preserve existing codes and details after resource extraction',async()=>{
 const errors=await json('en','errors');
 for(const [code,message] of Object.entries(errors))assert.deepEqual(safeError(new AppError(code,['detail'])),{code,message,details:['detail']});
 assert.deepEqual(safeError(new Error('private path')),{code:'IO',message:errors.IO,details:[]});
});
