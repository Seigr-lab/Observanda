import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {taskStarters,taskStarterDescription,createTaskRecord,taskBookConfiguration} from '../src/web/task-starters.js';
import {validConfiguration} from '../src/web/notebook-schema.js';
import {enableProfile} from '../src/web/laboratory/catalog.js';
// The app loads lab-book profile text at startup; this test does the same.
import '../src/web/i18n/catalogues/labBookProfiles.js';

test('every installed starter resolves to valid private authoring content in each supported catalogue',async()=>{
  const expected=['blankRecord','blankBook','projectDiary','illustratedProcedure','fieldVisit','lesson','studioSession','hiveInspection','methodsBook'];
  assert.deepEqual(taskStarters.map(starter=>starter.id),expected);
  for(const language of ['en','ca','es','nb','nn']){
    const messages=JSON.parse(await readFile(new URL('../src/web/locales/'+language+'/recordStarters.json',import.meta.url),'utf8'));
    const translate=key=>{assert.ok(messages[key],language+' '+key);return messages[key];};
    for(const starter of taskStarters){
      const details=taskStarterDescription(starter,translate);
      assert.ok(details.name&&details.description);
      assert.equal(starter.version,1);assert.equal(starter.examples,false);assert.equal(starter.migration,'independentCopy');
      assert.equal(starter.languageNamespace,'recordStarters');assert.equal(starter.accessibilityReview.method,'keyboard');
      assert.equal(starter.capability,starter.kind==='book'?'notebooks':'records');
      if(starter.kind==='book'){
        const configuration=taskBookConfiguration(details.sections,randomUUID);
        assert.ok(validConfiguration(configuration));assert.deepEqual(configuration.profiles,[]);
        const second=taskBookConfiguration(details.sections,randomUUID);
        assert.ok(configuration.sections.every(section=>!second.sections.some(other=>other.id===section.id)));
        if(starter.id==='blankBook')assert.deepEqual(configuration.sections,[]);
        else{
          configuration.sections[0].label='My method';const before=structuredClone(configuration.sections);
          enableProfile(configuration,'educational',true);
          enableProfile(configuration,'educational',false);enableProfile(configuration,'educational',true);
          assert.deepEqual(configuration.sections.filter(section=>section.profileId===null),before);
        }
      }else{
        const options={title:details.name,sections:details.sections,notebookId:randomUUID(),now:new Date().toISOString(),uuid:randomUUID};
        const a=createTaskRecord(starter,options),b=createTaskRecord(starter,options);
        assert.notEqual(a.id,b.id);assert.equal(a.share,false);assert.equal(a.body,'');
        assert.deepEqual([a.contributors,a.attachments,a.figures,a.relations],[[],[],[],[]]);
        assert.deepEqual(a.sections.map(section=>section.title),details.sections.map(section=>section.label));
        assert.ok(a.sections.every(section=>section.body===''&&!b.sections.some(other=>section.id===other.id)));
      }
    }
  }
});
