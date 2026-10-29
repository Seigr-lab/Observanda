import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {researchTargets as modelTargets,researchReference} from '../src/web/record-model.js';
import {researchTargets} from '../src/web/research-target-presentation.js';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';

test('research picker contexts translate without changing identities, authored names or model output',async context=>{
 context.after(()=>activateLanguage('en'));
 const book={id:crypto.randomUUID(),title:'Authored workspace',projects:[{id:crypto.randomUUID(),title:'Authored project',kind:'Project'},{id:crypto.randomUUID(),title:'Custom project',kind:'Authored <kind>'}],notebooks:[],entries:[]};
 book.notebooks.push({id:crypto.randomUUID(),title:'Authored notebook',projectId:book.projects[0].id});
 book.entries.push({id:crypto.randomUUID(),title:'Authored record',notebookId:book.notebooks[0].id});
 const original=structuredClone(book),canonical=modelTargets(book),references=canonical.map(researchReference);
 for(const language of ['en','ca','es','nb','nn']){
  await prepareLanguage(language,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(language);
  const displayed=researchTargets(book);
  assert.deepEqual(displayed.map(researchReference),references);assert.deepEqual(displayed.map(item=>item.title),canonical.map(item=>item.title));
  assert.equal(displayed[0].context,t('researchPicker','workspace'));
  assert.equal(displayed[1].context,t('projectEditors','project')+' · Authored project');
  assert.equal(displayed[2].context,'Authored <kind> · Custom project');
  assert.equal(displayed[3].context,t('projectEditors','labBook')+' · Authored project');
  assert.equal(displayed[4].context,t('researchPicker','record')+' · Authored notebook');
  assert.deepEqual(modelTargets(book),canonical);assert.deepEqual(book,original);
 }
});
