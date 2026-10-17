import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import * as formats from '../src/catalogue-format.js';
import {writeCatalogueArchive,readCatalogueStream} from '../src/postgres-archive.js';
import {seal} from '../src/encryption.js';
import {projectDomainSchema} from '../src/project-domain-schema.js';
import {requirePublicationDocumentStorage,assertPublicationDocumentStorage} from '../src/publication-document-storage.js';
import {catalogueContext} from '../src/research-catalogue.js';

function database(version,{optionalDomains=false,payload=null,domains=[]}={}){
 const id=randomUUID(),schema='obs_'+id.replaceAll('-','');let selected=schema;
 return {id,schema,version,retiredIndex:version>=23,inserted:[],domains:[...domains],
  async all(sql,...values){
   if(sql==='SELECT version FROM catalogue_format')return [{version:this.version}];
   if(sql.startsWith('SELECT nspname FROM pg_catalog.pg_namespace '))return this.domains.map(domain=>({nspname:projectDomainSchema(id,domain)}));
   if(sql.includes('FROM state')&&selected===schema&&payload)return [{slot:'head',payload}];
   assert.fail('Unexpected query: '+sql);
  },
  async get(sql,slot){if(sql==="SELECT 1 FROM state WHERE slot='head'")return this.inserted.some(values=>values[0]==='head')?{found:1}:null;assert.equal(sql,'SELECT 1 FROM state WHERE slot=$1');assert.equal(slot,'project-domains');return optionalDomains?{found:1}:null;},
  async *rows(){if(this.schema===schema&&payload)yield {slot:'head',payload_bytes:payload.length};},
  async run(sql,...values){
   if(sql.startsWith('SET LOCAL search_path TO ')){selected=sql.split('"')[1];return;}
   if(sql.startsWith('UPDATE catalogue_format')){this.version=Math.max(this.version,values[0]);return;}
   if(sql.startsWith('CREATE INDEX records_scope_revision')){assert.equal(this.retiredIndex,false);this.retiredIndex=true;return;}
   if(sql.startsWith('INSERT INTO state ')){this.inserted.push(values);return;}
   assert.ok(sql.startsWith('ALTER TABLE catalogue_format')||sql.startsWith('CREATE SCHEMA ')||sql.startsWith('REVOKE ALL ')||sql.startsWith('CREATE TABLE domain_format'),sql);
  }
 };
}
const combinations=[];
for(let website=0;website<4;website++)for(const staged of [false,true])for(let owners=0;owners<3;owners++)combinations.push({website,staged,owners});
const legacyGeneration=({website,staged,owners})=>(website===0?staged?32:26:website===1?staged?35:29:website===2?staged?41:38:staged?47:44)+owners;
function requirements(format){return {domains:formats.catalogueRequiresDomains(format),settings:formats.catalogueRequiresSettings(format),websites:formats.catalogueRequiresWebsites(format),editor:formats.catalogueRequiresWebsiteEditor(format),presentation:formats.catalogueRequiresWebsitePresentation(format),staged:formats.catalogueRequiresStagedEvidence(format)};}
function expected(features){return {domains:features.owners>=1,settings:features.owners===2,websites:features.website>=1,editor:features.website>=2,presentation:features.website===3,staged:features.staged};}

test('publication admission and every existing feature transition preserve all 24 owner combinations',async()=>{
 const transitions=[[formats.requireWorkspaceDomains,{owners:1}],[formats.requireProjectDomains,{owners:1}],[formats.requireWorkspaceSettings,{owners:2}],[formats.requireWebsiteDocuments,{website:1}],[formats.requireWebsiteEditor,{website:2}],[formats.requireWebsitePresentation,{website:3}],[formats.requireStagedEvidence,{staged:true}]];
 const olderAdmissions=Object.entries(formats).filter(([name])=>name.startsWith('require')&&!transitions.some(([admit])=>admit===formats[name])&&!['requirePublicationDocuments','requireRecordOwnerTransfers','requireConfigurationDocuments'].includes(name)).map(([,admit])=>admit);
 const generations=new Set();
 for(const features of combinations){
  const generation=formats.publicationCatalogueGeneration(features);generations.add(generation);
  assert.deepEqual(formats.publicationCatalogueFeatures(generation),features);assert.deepEqual(requirements(generation),expected(features));
  const admitted=database(legacyGeneration(features));await formats.requirePublicationDocuments(admitted);assert.equal(admitted.version,generation);assert.equal(admitted.retiredIndex,true);
  await formats.requirePublicationDocuments(admitted);for(const admit of olderAdmissions)await admit(admitted);assert.equal(admitted.version,generation);
  const restored=database(3);await formats.restorePublicationCatalogueFormat(restored,generation);assert.equal(restored.version,generation);assert.equal(restored.retiredIndex,true);
  for(const [admit,change] of transitions){
   const db=database(generation);await admit(db);const next={website:Math.max(features.website,change.website??0),staged:features.staged||change.staged===true,owners:Math.max(features.owners,change.owners??0)};
   assert.deepEqual(requirements(db.version),expected(next));assert.deepEqual(formats.publicationCatalogueFeatures(db.version),next);await admit(db);assert.equal(db.version,formats.publicationCatalogueGeneration(next));
  }
 }
 assert.deepEqual([...generations],Array.from({length:24},(_,index)=>50+index));
 for(let version=3;version<=49;version++){
  const before=requirements(version),db=database(version);await formats.requirePublicationDocuments(db);assert.deepEqual(requirements(db.version),before);assert.equal(db.retiredIndex,true);
 }
 const oldProject=database(23,{optionalDomains:true});await formats.requirePublicationDocuments(oldProject);assert.deepEqual(formats.publicationCatalogueFeatures(oldProject.version),{website:0,staged:false,owners:1});
 for(const invalid of [49,74,50.5,null]){assert.equal(formats.catalogueRequiresPublicationDocuments(invalid),false);await assert.rejects(formats.restorePublicationCatalogueFormat(database(3),invalid),{code:'CATALOGUE_DAMAGED'});}
});

test('archive 13 carries all 24 exact capabilities and rejects missing or invented domain requirements',async()=>{
 const payload=seal(Buffer.from('Exact immutable publication state'),randomBytes(32),'test'),tables={state:['slot','payload']};
 for(const features of combinations){
  const version=formats.publicationCatalogueGeneration(features),domains=features.owners?['tasks']:[],parts=[];
  await writeCatalogueArchive(database(version,{payload,domains}),{writeFile:async text=>parts.push(text)},tables,{observe:false});
  const raw=parts.join(''),lines=raw.trimEnd().split('\n'),header=JSON.parse(lines[0]);assert.equal(header.version,13);assert.equal(header.catalogueVersion,version);assert.deepEqual(header.domains,domains);
  const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(raw)]),restored,tables);assert.equal(restored.version,version);assert.deepEqual(restored.inserted,[['head',payload]]);
  for(const change of [{version:12},{catalogueVersion:74},{domains:features.owners?[]:['tasks']}]){
   const damaged=JSON.stringify({...header,...change})+'\n'+lines.slice(1).join('\n')+'\n';await assert.rejects(readCatalogueStream(Readable.from([Buffer.from(damaged)]),database(3),tables),{code:'CATALOGUE_DAMAGED'});
  }
 }
});

test('publication storage admission reuses only an ambient writer and refuses file or cancelled admission',async()=>{
 const db=database(49),workspace={root:'in-memory-owner',async storageKind(){return 'catalogue';},async catalogue(operation){return operation({db});},async withLock(operation){this.locks++;return operation();},locks:0};
 await catalogueContext.run({root:workspace.root,db},()=>assertPublicationDocumentStorage(workspace));assert.equal(workspace.locks,0);assert.equal(db.version,73);
 await catalogueContext.run({root:'different-owner'},()=>requirePublicationDocumentStorage(workspace));assert.equal(workspace.locks,1);
 const controller=new AbortController();controller.abort();await assert.rejects(assertPublicationDocumentStorage(workspace,{signal:controller.signal}),{name:'AbortError'});assert.equal(workspace.locks,1);
 const file={async storageKind(){return 'file';},withLock(){assert.fail('File workspace writer was entered');}};assert.equal(await requirePublicationDocumentStorage(file),false);await assert.rejects(assertPublicationDocumentStorage(file),{code:'FORMAT'});
});


test('record transfers preserve all 48 independent capability combinations and later admissions',async()=>{
 const transitions=[[formats.requireWorkspaceDomains,{owners:1}],[formats.requireProjectDomains,{owners:1}],[formats.requireWorkspaceSettings,{owners:2}],[formats.requireWebsiteDocuments,{website:1}],[formats.requireWebsiteEditor,{website:2}],[formats.requireWebsitePresentation,{website:3}],[formats.requireStagedEvidence,{staged:true}],[formats.requirePublicationDocuments,{publication:true}]];
 const seen=new Set();
 for(const publication of [false,true])for(const ordinary of combinations){
  const features={...ordinary,publication},generation=formats.recordOwnerTransferCatalogueGeneration(features);seen.add(generation);
  assert.deepEqual(formats.recordOwnerTransferCatalogueFeatures(generation),features);assert.equal(formats.catalogueRequiresRecordOwnerTransfers(generation),true);assert.equal(formats.catalogueRequiresPublicationDocuments(generation),publication);assert.deepEqual(requirements(generation),expected(features));
  const db=database(publication?formats.publicationCatalogueGeneration(ordinary):legacyGeneration(ordinary));await formats.requireRecordOwnerTransfers(db);assert.equal(db.version,generation);assert.equal(db.retiredIndex,true);await formats.requireRecordOwnerTransfers(db);assert.equal(db.version,generation);
  const restored=database(3);await formats.restoreRecordOwnerTransferCatalogueFormat(restored,generation);assert.equal(restored.version,generation);assert.equal(restored.retiredIndex,true);
  for(const [admit,change] of transitions){
   const changing=database(generation);await admit(changing);
   const next={website:Math.max(features.website,change.website??0),staged:features.staged||change.staged===true,owners:Math.max(features.owners,change.owners??0),publication:features.publication||change.publication===true};
   assert.deepEqual(formats.recordOwnerTransferCatalogueFeatures(changing.version),next);await admit(changing);assert.equal(changing.version,formats.recordOwnerTransferCatalogueGeneration(next));
  }
 }
 assert.deepEqual([...seen],Array.from({length:48},(_,i)=>74+i));
 for(let version=3;version<=73;version++){
  const db=database(version),before=requirements(version),publication=formats.catalogueRequiresPublicationDocuments(version);
  await formats.requireRecordOwnerTransfers(db);assert.deepEqual(requirements(db.version),before);assert.equal(formats.catalogueRequiresPublicationDocuments(db.version),publication);
 }
 const oldProject=database(23,{optionalDomains:true});await formats.requireRecordOwnerTransfers(oldProject);assert.equal(formats.catalogueRequiresDomains(oldProject.version),true);
 for(const invalid of [73,122,74.5,null]){assert.equal(formats.catalogueRequiresRecordOwnerTransfers(invalid),false);await assert.rejects(formats.restoreRecordOwnerTransferCatalogueFormat(database(3),invalid),{code:'CATALOGUE_DAMAGED'});}
});

test('archive 14 restores transfer capabilities without adding or omitting owners',async()=>{
 const payload=seal(Buffer.from('Retained record ownership receipt'),randomBytes(32),'test'),tables={state:['slot','payload']};
 for(const publication of [false,true])for(const ordinary of combinations){
  const version=formats.recordOwnerTransferCatalogueGeneration({...ordinary,publication}),domains=ordinary.owners?['tasks']:[],parts=[];
  await writeCatalogueArchive(database(version,{payload,domains}),{writeFile:async text=>parts.push(text)},tables,{observe:false});
  const raw=parts.join(''),lines=raw.trimEnd().split('\n'),header=JSON.parse(lines[0]);assert.equal(header.version,14);assert.equal(header.catalogueVersion,version);
  const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(raw)]),restored,tables);assert.equal(restored.version,version);assert.deepEqual(restored.inserted,[['head',payload]]);
  for(const change of [{version:13},{catalogueVersion:73},{catalogueVersion:122},{domains:ordinary.owners?[]:['tasks']}]){
   const damaged=JSON.stringify({...header,...change})+'\n'+lines.slice(1).join('\n')+'\n';await assert.rejects(readCatalogueStream(Readable.from([Buffer.from(damaged)]),database(3),tables),{code:'CATALOGUE_DAMAGED'});
  }
 }
});


test('configuration documents preserve all 96 capability combinations in either upgrade order',async()=>{
 const transitions=[[formats.requireWorkspaceDomains,{owners:1}],[formats.requireProjectDomains,{owners:1}],[formats.requireWorkspaceSettings,{owners:2}],[formats.requireWebsiteDocuments,{website:1}],[formats.requireWebsiteEditor,{website:2}],[formats.requireWebsitePresentation,{website:3}],[formats.requireStagedEvidence,{staged:true}],[formats.requirePublicationDocuments,{publication:true}],[formats.requireRecordOwnerTransfers,{transfers:true}]];
 const seen=new Set();
 for(const transfers of [false,true])for(const publication of [false,true])for(const ordinary of combinations){
  const features={...ordinary,publication,transfers},generation=formats.configurationCatalogueGeneration(features);seen.add(generation);
  assert.deepEqual(formats.configurationCatalogueFeatures(generation),features);assert.equal(formats.catalogueRequiresConfigurationDocuments(generation),true);assert.deepEqual(requirements(generation),expected(features));assert.equal(formats.catalogueRequiresPublicationDocuments(generation),publication);assert.equal(formats.catalogueRequiresRecordOwnerTransfers(generation),transfers);
  const previous=transfers?formats.recordOwnerTransferCatalogueGeneration({...ordinary,publication}):publication?formats.publicationCatalogueGeneration(ordinary):legacyGeneration(ordinary),db=database(previous);
  await formats.requireConfigurationDocuments(db);assert.equal(db.version,generation);await formats.requireConfigurationDocuments(db);assert.equal(db.version,generation);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,generation);assert.equal(restored.version,generation);assert.equal(restored.retiredIndex,true);
  if(publication){const restored=database(3);await formats.restorePublicationCatalogueFormat(restored,generation);assert.equal(restored.version,generation);}
  if(transfers){const restored=database(3);await formats.restoreRecordOwnerTransferCatalogueFormat(restored,generation);assert.equal(restored.version,generation);}
  for(const [admit,change] of transitions){
   const changing=database(generation);await admit(changing);const next={website:Math.max(features.website,change.website??0),staged:features.staged||change.staged===true,owners:Math.max(features.owners,change.owners??0),publication:features.publication||change.publication===true,transfers:features.transfers||change.transfers===true};
   assert.deepEqual(formats.configurationCatalogueFeatures(changing.version),next);await admit(changing);assert.equal(changing.version,formats.configurationCatalogueGeneration(next));
  }
 }
 assert.deepEqual([...seen],Array.from({length:96},(_,i)=>122+i));
 for(let version=3;version<=121;version++){
  const db=database(version),before=requirements(version),publication=formats.catalogueRequiresPublicationDocuments(version),transfers=formats.catalogueRequiresRecordOwnerTransfers(version);
  await formats.requireConfigurationDocuments(db);assert.deepEqual(requirements(db.version),before);assert.equal(formats.catalogueRequiresPublicationDocuments(db.version),publication);assert.equal(formats.catalogueRequiresRecordOwnerTransfers(db.version),transfers);
 }
 const oldProject=database(23,{optionalDomains:true});await formats.requireConfigurationDocuments(oldProject);assert.equal(formats.catalogueRequiresDomains(oldProject.version),true);
 for(const invalid of [121,218,122.5,null]){assert.equal(formats.catalogueRequiresConfigurationDocuments(invalid),false);await assert.rejects(formats.restoreConfigurationCatalogueFormat(database(3),invalid),{code:'CATALOGUE_DAMAGED'});}
 await assert.rejects(formats.catalogueFormat(database(218)),{code:'CATALOGUE_DAMAGED'});
});

test('archive 15 restores every configuration capability combination and rejects header downgrades',async()=>{
 const payload=seal(Buffer.from('Immutable configuration node'),randomBytes(32),'test'),tables={state:['slot','payload']};
 for(const transfers of [false,true])for(const publication of [false,true])for(const ordinary of combinations){
  const version=formats.configurationCatalogueGeneration({...ordinary,publication,transfers}),domains=ordinary.owners?['tasks']:[],parts=[];
  await writeCatalogueArchive(database(version,{payload,domains}),{writeFile:async text=>parts.push(text)},tables,{observe:false});
  const raw=parts.join(''),lines=raw.trimEnd().split('\n'),header=JSON.parse(lines[0]);assert.equal(header.version,15);assert.equal(header.catalogueVersion,version);assert.deepEqual(header.domains,domains);
  const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(raw)]),restored,tables);assert.equal(restored.version,version);assert.deepEqual(restored.inserted,[['head',payload]]);
  for(const change of [{version:14},{version:13},{catalogueVersion:121},{catalogueVersion:218},{domains:ordinary.owners?[]:['tasks']}]){
   const damaged=JSON.stringify({...header,...change})+'\n'+lines.slice(1).join('\n')+'\n';await assert.rejects(readCatalogueStream(Readable.from([Buffer.from(damaged)]),database(3),tables),{code:'CATALOGUE_DAMAGED'});
  }
 }
});
