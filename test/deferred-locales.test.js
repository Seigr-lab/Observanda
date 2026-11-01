import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {t,language,prepareLanguage,activateLanguage,prepareNamespaces,registerCatalogue,catalogueLanguages,MESSAGE_NAMESPACES} from '../src/web/i18n/index.js';
import {guideWithMessages,guideMessageNamespaces} from '../src/web/help/model.js';

const resource=name=>readFile(new URL('../src/web/locales/'+name,import.meta.url),'utf8').then(JSON.parse);
const fetchResource=async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))});

test('the shell leaves feature messages unloaded and rejects unknown namespace paths before importing',async()=>{
 assert.throws(()=>t('pdfEditor','title'),/has not been loaded/);
 await assert.rejects(prepareNamespaces(['pdfEditor','../private']),/Unknown message namespace/);
 assert.throws(()=>t('pdfEditor','title'),/has not been loaded/);
 await assert.rejects(prepareNamespaces('pdfEditor'),/Unknown message namespace/);
});

test('Help loads only its referenced control namespaces without opening their editors',async()=>{
 const guide=await resource('en/guide.json'),names=guideMessageNamespaces(guide);
 assert.ok(names.includes('localIntake'));assert.ok(!names.includes('sketch'));
 await prepareNamespaces(names);
 assert.ok(!JSON.stringify(guideWithMessages(guide,t)).includes('{ui:'));
 assert.throws(()=>t('sketch','title'),/has not been loaded/);
});

test('feature messages retain translated catalogues across language changes and restore English on request',async()=>{
 await prepareLanguage('nn',{fetcher:fetchResource});activateLanguage('nn');
 await Promise.all([prepareNamespaces(['pdfEditor']),prepareNamespaces(['pdfEditor','pdfEditor'])]);
 const reference=await resource('en/pdfEditor.json');
 const key=Object.keys(reference).find(key=>typeof reference[key]==='string'&&!reference[key].includes('{'));
 assert.equal(t('pdfEditor',key),(await resource('nn/pdfEditor.json'))[key]);assert.equal(language(),'nn');
 assert.throws(()=>registerCatalogue('pdfEditor',reference),/Invalid catalogue registration/);
 let reads=0;
 const fetcher=async url=>{reads++;return fetchResource(url);};
 await Promise.all([prepareLanguage('es',{fetcher}),prepareLanguage('es',{fetcher})]);
 assert.equal(reads,MESSAGE_NAMESPACES.filter(name=>catalogueLanguages(name).includes('es')).length);
 activateLanguage('es');assert.equal(t('pdfEditor',key),(await resource('es/pdfEditor.json'))[key]);
 assert.equal(t('preferences','title'),(await resource('es/preferences.json')).title);
 activateLanguage('en');assert.equal(t('pdfEditor',key),reference[key]);
});

test('a failed language load drains its bounded requests before allowing a complete retry',async()=>{
 const gate=Promise.withResolvers();let reads=0,settled=false;
 const fetcher=async url=>{if(++reads===1)return {ok:false};await gate.promise;return fetchResource(url);};
 const first=prepareLanguage('ca',{fetcher}),failure=first.catch(error=>{settled=true;return error;});
 let repeated;
 try{
  await setImmediate();
  assert.equal(settled,false,'An outstanding catalogue must finish before retry is available');
  assert.ok(reads>1&&reads<=6,'Language loading must bound concurrent resource requests');
  const before=reads;repeated=prepareLanguage('ca',{fetcher});repeated.catch(()=>{});
  await setImmediate();assert.equal(reads,before,'A second attempt must share the draining load');
 }finally{gate.resolve();await failure;}
 await assert.rejects(first,/Language resource unavailable/);
 if(repeated)await assert.rejects(repeated,/Language resource unavailable/);
 assert.equal(language(),'en');
 let retryReads=0;
 await prepareLanguage('ca',{fetcher:async url=>{retryReads++;return fetchResource(url);}});
 assert.equal(retryReads,MESSAGE_NAMESPACES.filter(name=>catalogueLanguages(name).includes('ca')).length);
 activateLanguage('ca');assert.equal(t('preferences','title'),(await resource('ca/preferences.json')).title);activateLanguage('en');
});
