import {readProjectDomainRegistry,writeProjectDomainRegistry} from '../src/project-domain-registry.js';
import {projectDomainSchema} from '../src/project-domain-schema.js';
// Seed realistic immutable state without measuring thousands of UI commands.
// Production command behavior is tested separately against this retained data.
import {SampleAnalysisCatalogue} from '../src/sample-analysis-catalogue.js';
import {validateLab} from '../src/sample-analysis-model.js';
import {buildIndex} from '../src/index-builder.js';
export async function seedSampleAnalysis(store,lab){
 validateLab(lab);const owner=new SampleAnalysisCatalogue(store),head=(await owner.source('new')).head;
 head.revision=lab.revision;head.lastEventHash=lab.events.at(-1)?.hash??'';
 const samples=new Map(lab.samples.map(s=>[s.id,s]));
 async function* entries(){
  for(const [kind,field] of [['sample','samples'],['analysis','analyses'],['event','events']]){
   let position=0;
   for(const record of lab[field]){
    const member=owner.describe(kind,record,position++,samples.get(record.sampleId));await owner.retain(record);const revision=await owner.retain(member);
    head.bytes[field]+=Buffer.byteLength(JSON.stringify(record,null,2))+4*JSON.stringify(record,null,2).split('\n').length;
    if(kind==='analysis')owner.count(head,record,1);else head.counts[field]++;
    for(const id of owner.keys(member))yield {id,revision};
   }
  }
 }
 head.root=await buildIndex(store,owner.index,entries(),()=>{throw Error('Invalid sample fixture index');});
 await store.putObject('laboratory',head);return head;
}

export async function legacySampleAnalysisFixture(workspace){
 await workspace.withLock(()=>workspace.catalogue(async store=>{
  const registry=await readProjectDomainRegistry(store);if(!registry?.domains.includes('samples'))return;
  await store.db.run('DROP SCHEMA "'+projectDomainSchema(store.db.id,'samples')+'" CASCADE');
  await writeProjectDomainRegistry(store,registry.domains.filter(d=>d!=='samples'),registry.namespaceId,registry);
 }));
}
