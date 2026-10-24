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
   if(sql==='LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT')return;
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
 const olderAdmissions=Object.entries(formats).filter(([name])=>name.startsWith('require')&&!transitions.some(([admit])=>admit===formats[name])&&!['requirePublicationDocuments','requireRecordOwnerTransfers','requireConfigurationDocuments','requireSourcePublicationControls','requireWebsiteSourceSelections','requireNestedAttemptCollections','requireOwnerDirectories','requirePortabilityCollections','requireWebsiteTemplateInheritance','requirePagedResearchTables','requireNativeNumericalModels','requireNativeClockModels','requireRetainedFigures','requireReferencedCalculations','requireReviewFigurePackages','requireNativeDomainValues','requireCalculationPolicies','requireClockDerivations','requireFigureAuthoring','requireIntervalUncertainty','requireDatasetResourcePolicies','requireWindowCalculations','requireFigureProjectionPolicies','requireCalculatorDatasetResults','requireMeasurementScalarPolicies','requireDomainAlgebra','requireStructuredCalculator','requireApproximateCalculator','requireClockSynchronization','requireTensorValues','requireQuantileAggregation','requireAxisPermutation','requirePairedStatistics'].includes(name)).map(([,admit])=>admit);
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
 for(const invalid of [121,(formats.CATALOGUE_MAX_GENERATION+1),122.5,null]){assert.equal(formats.catalogueRequiresConfigurationDocuments(invalid),false);await assert.rejects(formats.restoreConfigurationCatalogueFormat(database(3),invalid),{code:'CATALOGUE_DAMAGED'});}
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});

test('archive 15 restores every configuration capability combination and rejects header downgrades',async()=>{
 const payload=seal(Buffer.from('Immutable configuration node'),randomBytes(32),'test'),tables={state:['slot','payload']};
 for(const transfers of [false,true])for(const publication of [false,true])for(const ordinary of combinations){
  const version=formats.configurationCatalogueGeneration({...ordinary,publication,transfers}),domains=ordinary.owners?['tasks']:[],parts=[];
  await writeCatalogueArchive(database(version,{payload,domains}),{writeFile:async text=>parts.push(text)},tables,{observe:false});
  const raw=parts.join(''),lines=raw.trimEnd().split('\n'),header=JSON.parse(lines[0]);assert.equal(header.version,15);assert.equal(header.catalogueVersion,version);assert.deepEqual(header.domains,domains);
  const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(raw)]),restored,tables);assert.equal(restored.version,version);assert.deepEqual(restored.inserted,[['head',payload]]);
  for(const change of [{version:14},{version:13},{catalogueVersion:121},{catalogueVersion:(formats.CATALOGUE_MAX_GENERATION+1)},{domains:ordinary.owners?[]:['tasks']}]){
   const damaged=JSON.stringify({...header,...change})+'\n'+lines.slice(1).join('\n')+'\n';await assert.rejects(readCatalogueStream(Readable.from([Buffer.from(damaged)]),database(3),tables),{code:'CATALOGUE_DAMAGED'});
  }
 }
});


test('paged website choices preserve all 192 prior capability combinations through subsequent upgrades and archive restoration',async()=>{
 const transitions=[[formats.requireWorkspaceDomains,{owners:1}],[formats.requireWorkspaceSettings,{owners:2}],[formats.requireWebsiteDocuments,{website:1}],[formats.requireWebsiteEditor,{website:2}],[formats.requireWebsitePresentation,{website:3}],[formats.requireStagedEvidence,{staged:true}],[formats.requirePublicationDocuments,{publication:true}],[formats.requireRecordOwnerTransfers,{transfers:true}],[formats.requireSourcePublicationControls,{permissions:true}]];
 const payload=seal(Buffer.from('Retained website source choices'),randomBytes(32),'test'),tables={state:['slot','payload']},seen=new Set();
 for(let previous=122;previous<=313;previous++){
  const features=formats.configurationCatalogueFeatures(previous),db=database(previous),next={...features,sourceSelections:true};
  assert.equal(formats.catalogueRequiresWebsiteSourceSelections(previous),false);
  await formats.requireWebsiteSourceSelections(db);const generation=db.version;seen.add(generation);
  assert.equal(generation,previous+192);assert.deepEqual(formats.configurationCatalogueFeatures(generation),next);
  assert.deepEqual(requirements(generation),requirements(previous));assert.equal(formats.catalogueRequiresSourcePublicationControls(generation),features.permissions===true);
  await formats.requireWebsiteSourceSelections(db);assert.equal(db.version,generation);
  for(const [admit,change] of transitions){
   const changing=database(generation);await admit(changing);
   const expected={...next,...change,website:Math.max(next.website,change.website??0),owners:Math.max(next.owners,change.owners??0)};
   assert.deepEqual(formats.configurationCatalogueFeatures(changing.version),expected);await admit(changing);assert.equal(changing.version,formats.configurationCatalogueGeneration(expected));
   const reverse=database(previous);await admit(reverse);await formats.requireWebsiteSourceSelections(reverse);assert.equal(reverse.version,changing.version);
  }
  const domains=features.owners?['tasks']:[],parts=[];
  await writeCatalogueArchive(database(generation,{payload,domains}),{writeFile:async text=>parts.push(text)},tables,{observe:false});
  const raw=parts.join(''),lines=raw.trimEnd().split('\n'),header=JSON.parse(lines[0]);assert.equal(header.version,15);assert.equal(header.catalogueVersion,generation);
  const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(raw)]),restored,tables);
  assert.equal(restored.version,generation);assert.deepEqual(restored.inserted,[['head',payload]]);
  for(const restore of [formats.restoreConfigurationCatalogueFormat,...(features.publication?[formats.restorePublicationCatalogueFormat]:[]),...(features.transfers?[formats.restoreRecordOwnerTransferCatalogueFormat]:[])]){
   const target=database(3);await restore(target,generation);assert.equal(target.version,generation);
  }
 }
 assert.deepEqual([...seen],Array.from({length:192},(_,i)=>314+i));
 const invalid=database((formats.CATALOGUE_MAX_GENERATION+1));await assert.rejects(formats.catalogueFormat(invalid),{code:'CATALOGUE_DAMAGED'});
});


test('nested preparation admission preserves all 384 prior combinations through owner upgrades and archive restoration',async()=>{
 const transitions=[[formats.requireWorkspaceDomains,{owners:1}],[formats.requireProjectDomains,{owners:1}],[formats.requireWorkspaceSettings,{owners:2}],[formats.requireWebsiteDocuments,{website:1}],[formats.requireWebsiteEditor,{website:2}],[formats.requireWebsitePresentation,{website:3}],[formats.requireStagedEvidence,{staged:true}],[formats.requirePublicationDocuments,{publication:true}],[formats.requireRecordOwnerTransfers,{transfers:true}],[formats.requireSourcePublicationControls,{permissions:true}],[formats.requireWebsiteSourceSelections,{sourceSelections:true}]];
 const payload=seal(Buffer.from('Retained nested preparation and draft receipt'),randomBytes(32),'test'),tables={state:['slot','payload']},seen=new Set();
 for(let previous=122;previous<=505;previous++){
  const features=formats.configurationCatalogueFeatures(previous),db=database(previous),next={...features,nestedAttempts:true};
  assert.equal(formats.catalogueRequiresNestedAttemptCollections(previous),false);
  await formats.requireNestedAttemptCollections(db);const generation=db.version;seen.add(generation);
  assert.equal(generation,previous+384);assert.deepEqual(formats.configurationCatalogueFeatures(generation),next);
  assert.deepEqual(requirements(generation),requirements(previous));
  assert.equal(formats.catalogueRequiresSourcePublicationControls(generation),features.permissions===true);
  assert.equal(formats.catalogueRequiresWebsiteSourceSelections(generation),features.sourceSelections===true);
  await formats.requireNestedAttemptCollections(db);assert.equal(db.version,generation);
  for(const [admit,change] of transitions){
   const changing=database(generation);await admit(changing);
   const expected={...next,...change,website:Math.max(next.website,change.website??0),owners:Math.max(next.owners,change.owners??0)};
   assert.deepEqual(formats.configurationCatalogueFeatures(changing.version),expected);await admit(changing);assert.equal(changing.version,formats.configurationCatalogueGeneration(expected));
   const reverse=database(previous);await admit(reverse);await formats.requireNestedAttemptCollections(reverse);assert.equal(reverse.version,changing.version);
  }
  const domains=features.owners?['tasks']:[],parts=[];
  await writeCatalogueArchive(database(generation,{payload,domains}),{writeFile:async text=>parts.push(text)},tables,{observe:false});
  const raw=parts.join(''),header=JSON.parse(raw.split('\n')[0]);assert.equal(header.version,15);assert.equal(header.catalogueVersion,generation);
  const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(raw)]),restored,tables);
  assert.equal(restored.version,generation);assert.deepEqual(restored.inserted,[['head',payload]]);
  for(const restore of [formats.restoreConfigurationCatalogueFormat,...(features.publication?[formats.restorePublicationCatalogueFormat]:[]),...(features.transfers?[formats.restoreRecordOwnerTransferCatalogueFormat]:[])]){
   const target=database(3);await restore(target,generation);assert.equal(target.version,generation);
  }
 }
 assert.deepEqual([...seen],Array.from({length:384},(_,i)=>506+i));
 for(const nestedAttempts of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),nestedAttempts}),{code:'INVALID'});
 for(const invalid of [(formats.CATALOGUE_MAX_GENERATION+1),506.5,null])await assert.rejects(formats.catalogueFormat(database(invalid)),{code:'CATALOGUE_DAMAGED'});
});

test('native directory admission preserves all 768 prior combinations through owner upgrades and archive restoration',async()=>{
 const transitions=[[formats.requireWorkspaceDomains,{owners:1}],[formats.requireProjectDomains,{owners:1}],[formats.requireWorkspaceSettings,{owners:2}],[formats.requireWebsiteDocuments,{website:1}],[formats.requireWebsiteEditor,{website:2}],[formats.requireWebsitePresentation,{website:3}],[formats.requireStagedEvidence,{staged:true}],[formats.requirePublicationDocuments,{publication:true}],[formats.requireRecordOwnerTransfers,{transfers:true}],[formats.requireSourcePublicationControls,{permissions:true}],[formats.requireWebsiteSourceSelections,{sourceSelections:true}],[formats.requireNestedAttemptCollections,{nestedAttempts:true}]];
 const payload=seal(Buffer.from('Retained native directory and adoption receipt'),randomBytes(32),'test'),tables={state:['slot','payload']},seen=new Set();
 for(let previous=122;previous<=889;previous++){
  const features=formats.configurationCatalogueFeatures(previous),db=database(previous),next={...features,ownerDirectories:true};
  assert.equal(formats.catalogueRequiresOwnerDirectories(previous),false);
  await formats.requireOwnerDirectories(db);const generation=db.version;seen.add(generation);
  assert.equal(generation,previous+768);assert.deepEqual(formats.configurationCatalogueFeatures(generation),next);
  assert.deepEqual(requirements(generation),requirements(previous));
  assert.equal(formats.catalogueRequiresSourcePublicationControls(generation),features.permissions===true);
  assert.equal(formats.catalogueRequiresWebsiteSourceSelections(generation),features.sourceSelections===true);
  assert.equal(formats.catalogueRequiresNestedAttemptCollections(generation),features.nestedAttempts===true);
  await formats.requireOwnerDirectories(db);assert.equal(db.version,generation);
  for(const [admit,change] of transitions){
   const changing=database(generation);await admit(changing);
   const expected={...next,...change,website:Math.max(next.website,change.website??0),owners:Math.max(next.owners,change.owners??0)};
   assert.deepEqual(formats.configurationCatalogueFeatures(changing.version),expected);await admit(changing);assert.equal(changing.version,formats.configurationCatalogueGeneration(expected));
   const reverse=database(previous);await admit(reverse);await formats.requireOwnerDirectories(reverse);assert.equal(reverse.version,changing.version);
  }
  const domains=features.owners?['tasks']:[],parts=[];
  await writeCatalogueArchive(database(generation,{payload,domains}),{writeFile:async text=>parts.push(text)},tables,{observe:false});
  const raw=parts.join(''),header=JSON.parse(raw.split('\n')[0]);assert.equal(header.version,15);assert.equal(header.catalogueVersion,generation);
  const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(raw)]),restored,tables);
  assert.equal(restored.version,generation);assert.deepEqual(restored.inserted,[['head',payload]]);
  for(const restore of [formats.restoreConfigurationCatalogueFormat,...(features.publication?[formats.restorePublicationCatalogueFormat]:[]),...(features.transfers?[formats.restoreRecordOwnerTransferCatalogueFormat]:[])]){
   const target=database(3);await restore(target,generation);assert.equal(target.version,generation);
  }
 }
 assert.deepEqual([...seen],Array.from({length:768},(_,i)=>890+i));
 for(const ownerDirectories of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),ownerDirectories}),{code:'INVALID'});
 for(const invalid of [(formats.CATALOGUE_MAX_GENERATION+1),506.5,null])await assert.rejects(formats.catalogueFormat(database(invalid)),{code:'CATALOGUE_DAMAGED'});
});

test('native portability generations preserve all prior feature and restore combinations',async()=>{
 for(let previous=122;previous<=1657;previous++){
  const features=formats.configurationCatalogueFeatures(previous),db=database(previous);await formats.requirePortabilityCollections(db);
  assert.equal(db.version,previous+1536);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...features,portability:true});assert.equal(formats.catalogueRequiresPortabilityCollections(db.version),true);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
  await formats.requireOwnerDirectories(db);assert.equal(formats.catalogueRequiresPortabilityCollections(db.version),true);assert.equal(formats.catalogueRequiresOwnerDirectories(db.version),true);
 }
 for(const portability of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),portability}),{code:'INVALID'});
});


test('paged research admission restores every existing feature without manufacturing a template or publication owner',async()=>{
 for(let prior=122;prior<=6265;prior+=1){
  const features=formats.configurationCatalogueFeatures(prior),db=database(prior);await formats.requirePagedResearchTables(db);assert.equal(db.version,prior+6144);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...features,pagedResearchTables:true});assert.equal(formats.catalogueRequiresPagedResearchTables(db.version),true);assert.equal(formats.catalogueRequiresWebsiteTemplateInheritance(db.version),features.templateInheritance===true);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
  await formats.requirePagedResearchTables(db);assert.equal(db.version,restored.version);
 }
 for(const value of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),pagedResearchTables:value}),{code:'INVALID'});
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});


test('native numerical models preserve all prior owner and storage requirements through exact restoration',async()=>{
 for(let prior=122;prior<=12409;prior++){
  const features=formats.configurationCatalogueFeatures(prior),db=database(prior);await formats.requireNativeNumericalModels(db);
  assert.equal(db.version,prior+12288);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...features,nativeNumericalModels:true});
  assert.equal(formats.catalogueRequiresNativeNumericalModels(prior),false);assert.equal(formats.catalogueRequiresNativeNumericalModels(db.version),true);
  assert.equal(formats.catalogueRequiresPagedResearchTables(db.version),features.pagedResearchTables===true);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
  await formats.requireNativeNumericalModels(db);assert.equal(db.version,restored.version);
 }
 for(const nativeNumericalModels of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),nativeNumericalModels}),{code:'INVALID'});
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});

test('declared clock models restore independently of every prior numerical and owner feature',async()=>{
 for(let prior=122;prior<=24697;prior++){
  const features=formats.configurationCatalogueFeatures(prior),db=database(prior);await formats.requireNativeClockModels(db);
  assert.equal(db.version,prior+24576);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...features,nativeClockModels:true});
  assert.equal(formats.catalogueRequiresNativeClockModels(prior),false);assert.equal(formats.catalogueRequiresNativeClockModels(db.version),true);
  assert.equal(formats.catalogueRequiresNativeNumericalModels(db.version),features.nativeNumericalModels===true);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
  await formats.requireNativeClockModels(db);assert.equal(db.version,restored.version);
 }
 for(const nativeClockModels of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),nativeClockModels}),{code:'INVALID'});
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});

for(const [feature,suffix,bit] of [['retainedFigures','RetainedFigures',49152],['referencedCalculations','ReferencedCalculations',98304]])test(feature+' restores every prior storage feature independently',async()=>{
 const requireFeature=formats['require'+suffix],hasFeature=formats['catalogueRequires'+suffix];
 for(let prior=122;prior<122+bit;prior++){
  const features=formats.configurationCatalogueFeatures(prior),db=database(prior);await requireFeature(db);
  assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...features,[feature]:true});
  assert.equal(hasFeature(prior),false);assert.equal(hasFeature(db.version),true);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
  await requireFeature(db);assert.equal(db.version,restored.version);
 }
 for(const value of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),[feature]:value}),{code:'INVALID'});
});


test('figure review packets preserve independent requirements through admission and archive restoration',async()=>{
 const bit=196608;
 // Every existing encoding remains valid and does not gain an unrelated flag.
 for(let prior=122;prior<122+bit;prior++){
  const previous=formats.configurationCatalogueFeatures(prior),next=formats.configurationCatalogueFeatures(prior+bit);
  assert.deepEqual(next,{...previous,reviewFigurePackages:true});assert.equal(formats.configurationCatalogueGeneration(next),prior+bit);
  assert.equal(formats.catalogueRequiresReviewFigurePackages(prior),false);
 }
 const bits=[24,48,96,192,384,768,1536,3072,6144,12288,24576,49152,98304];
 for(const base of combinations)for(const offset of [0,...bits,bit-24]){
  const prior=formats.configurationCatalogueGeneration({...base,publication:false,transfers:false})+offset,db=database(prior);
  await formats.requireReviewFigurePackages(db);assert.equal(db.version,prior+bit);
  await formats.requireReviewFigurePackages(db);assert.equal(db.version,prior+bit);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
 }
 for(const reviewFigurePackages of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),reviewFigurePackages}),{code:'INVALID'});
 const payload=seal(Buffer.from('Signed review packet storage'),randomBytes(32),'test'),source=database(196730,{payload}),chunks=[];
 await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});
 const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});
 assert.equal(restored.version,196730);assert.equal(formats.catalogueRequiresReferencedCalculations(restored.version),false);assert.equal(formats.catalogueRequiresRetainedFigures(restored.version),false);
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});


test('native domain values preserve every prior requirement without implying review packet storage',async()=>{
 const bit=393216;
 for(let prior=122;prior<122+bit;prior++){
  const previous=formats.configurationCatalogueFeatures(prior),next=formats.configurationCatalogueFeatures(prior+bit);
  assert.deepEqual(next,{...previous,nativeDomainValues:true});assert.equal(formats.configurationCatalogueGeneration(next),prior+bit);
  assert.equal(formats.catalogueRequiresNativeDomainValues(prior),false);
 }
 const bits=[24,48,96,192,384,768,1536,3072,6144,12288,24576,49152,98304,196608];
 for(const base of combinations)for(const offset of [0,...bits,bit-24]){
  const prior=formats.configurationCatalogueGeneration({...base,publication:false,transfers:false})+offset,db=database(prior);
  await formats.requireNativeDomainValues(db);assert.equal(db.version,prior+bit);
  await formats.requireNativeDomainValues(db);assert.equal(db.version,prior+bit);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
 }
 for(const nativeDomainValues of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),nativeDomainValues}),{code:'INVALID'});
 const payload=seal(Buffer.from('Pinned domain value storage'),randomBytes(32),'test'),source=database(393338,{payload}),chunks=[];
 await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});
 const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});
 assert.equal(restored.version,393338);assert.equal(formats.catalogueRequiresReviewFigurePackages(restored.version),false);assert.equal(formats.catalogueRequiresReferencedCalculations(restored.version),false);
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});


test('calculation policies preserve every prior flag and exact archive restoration',async()=>{
 const bit=786432;
 for(let prior=122;prior<122+bit;prior++){
  const previous=formats.configurationCatalogueFeatures(prior),next=formats.configurationCatalogueFeatures(prior+bit);
  assert.deepEqual(next,{...previous,calculationPolicies:true});assert.equal(formats.configurationCatalogueGeneration(next),prior+bit);
  assert.equal(formats.catalogueRequiresCalculationPolicies(prior),false);
 }
 const bits=[24,48,96,192,384,768,1536,3072,6144,12288,24576,49152,98304,196608,393216];
 for(const base of combinations)for(const offset of [0,...bits,bit-24]){
  const prior=formats.configurationCatalogueGeneration({...base,publication:false,transfers:false})+offset,db=database(prior);
  await formats.requireCalculationPolicies(db);assert.equal(db.version,prior+bit);
  await formats.requireCalculationPolicies(db);assert.equal(db.version,prior+bit);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
 }
 for(const calculationPolicies of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),calculationPolicies}),{code:'INVALID'});
 const payload=seal(Buffer.from('Retained calculation policies'),randomBytes(32),'test'),source=database(786554,{payload}),chunks=[];
 await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});
 const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});
 assert.equal(restored.version,786554);assert.equal(formats.catalogueRequiresNativeDomainValues(restored.version),false);assert.equal(formats.catalogueRequiresReviewFigurePackages(restored.version),false);
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});


test('first policy admission refuses a contended format lock before any upgrade',async()=>{
 const db=database(122),run=db.run.bind(db);let changes=0;
 db.run=async(sql,...values)=>{if(sql==='LOCK TABLE catalogue_format IN ACCESS EXCLUSIVE MODE NOWAIT')throw Object.assign(new Error('busy'),{code:'55P03'});changes++;return run(sql,...values);};
 await assert.rejects(formats.requireCalculationPolicies(db),{code:'LOCKED'});assert.equal(db.version,122);assert.equal(changes,0);
 const admitted=database(786554);admitted.run=()=>assert.fail('An admitted policy must not take a new upgrade lock');await formats.requireCalculationPolicies(admitted);
});


test('clock derivations preserve every prior flag and exact archive restoration',async()=>{
 const bit=1572864;
 for(let prior=122;prior<122+bit;prior++){
  const previous=formats.configurationCatalogueFeatures(prior),next=formats.configurationCatalogueFeatures(prior+bit);
  assert.deepEqual(next,{...previous,clockDerivations:true});assert.equal(formats.configurationCatalogueGeneration(next),prior+bit);
  assert.equal(formats.catalogueRequiresClockDerivations(prior),false);
 }
 const bits=[24,48,96,192,384,768,1536,3072,6144,12288,24576,49152,98304,196608,393216,786432];
 for(const base of combinations)for(const offset of [0,...bits,bit-24]){
  const prior=formats.configurationCatalogueGeneration({...base,publication:false,transfers:false})+offset,db=database(prior);
  await formats.requireClockDerivations(db);assert.equal(db.version,prior+bit);
  await formats.requireClockDerivations(db);assert.equal(db.version,prior+bit);
  const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
 }
 for(const clockDerivations of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),clockDerivations}),{code:'INVALID'});
 const payload=seal(Buffer.from('Declared clock interval recipes'),randomBytes(32),'test'),source=database(1572986,{payload}),chunks=[];
 await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});
 const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});
 assert.equal(restored.version,1572986);assert.equal(formats.catalogueRequiresCalculationPolicies(restored.version),false);assert.equal(formats.catalogueRequiresNativeDomainValues(restored.version),false);
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});


test('manual figure draft admission preserves prior features and archives independently',async()=>{
 const bit=3145728,flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations'];
 for(const owner of combinations)for(const flag of [null,...flags,'all']){
  const features={...owner,publication:false,transfers:false};for(const name of flags)features[name]=flag==='all'||name===flag;
  const prior=formats.configurationCatalogueGeneration(features),db=database(prior),before=formats.configurationCatalogueFeatures(prior);
  await formats.requireFigureAuthoring(db);assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...before,figureAuthoring:true});
  await formats.requireFigureAuthoring(db);assert.equal(db.version,prior+bit);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
 }
 for(const figureAuthoring of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),figureAuthoring}),{code:'INVALID'});
 const payload=seal(Buffer.from('Incomplete retained figure checkpoint'),randomBytes(32),'test'),source=database(bit+122,{payload}),chunks=[];
 await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});
 const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,source.version);assert.equal(formats.catalogueRequiresClockDerivations(restored.version),false);
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});

test('interval uncertainty admission preserves authored figures and exact recovery',async()=>{
 const bit=6291456,flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations','figureAuthoring'];
 for(const owner of combinations)for(const flag of [null,...flags,'all']){
  const features={...owner,publication:false,transfers:false};for(const name of flags)features[name]=flag==='all'||name===flag;
  const prior=formats.configurationCatalogueGeneration(features),db=database(prior),before=formats.configurationCatalogueFeatures(prior);
  await formats.requireIntervalUncertainty(db);assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...before,intervalUncertainty:true});
  await formats.requireIntervalUncertainty(db);assert.equal(db.version,prior+bit);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
 }
 for(const intervalUncertainty of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),intervalUncertainty}),{code:'INVALID'});
 const payload=seal(Buffer.from('Declared interval uncertainty'),randomBytes(32),'test'),source=database(bit+122,{payload}),chunks=[];
 await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});
 const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,source.version);assert.equal(formats.catalogueRequiresClockDerivations(restored.version),false);
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});

test('dataset execution resource policies preserve independent requirements through archive restoration',async()=>{
 const bit=12582912,flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations','figureAuthoring','intervalUncertainty'];
 for(const owner of combinations)for(const flag of [null,...flags,'all']){
  const features={...owner,publication:false,transfers:false};for(const name of flags)features[name]=flag==='all'||name===flag;
  const prior=formats.configurationCatalogueGeneration(features),db=database(prior),before=formats.configurationCatalogueFeatures(prior);
  await formats.requireDatasetResourcePolicies(db);assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...before,datasetResourcePolicies:true});
  await formats.requireDatasetResourcePolicies(db);assert.equal(db.version,prior+bit);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
 }
 for(const datasetResourcePolicies of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),datasetResourcePolicies}),{code:'INVALID'});
 const payload=seal(Buffer.from('Declared dataset execution policy'),randomBytes(32),'test'),source=database(bit+122,{payload}),chunks=[];
 await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});
 const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,source.version);assert.equal(formats.catalogueRequiresClockDerivations(restored.version),false);
 await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});

test('window calculation requirements survive independent feature combinations and archive restoration',async()=>{
 const bit=25165824,base=formats.configurationCatalogueFeatures(122),flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations','figureAuthoring','intervalUncertainty','datasetResourcePolicies'];
 for(const owner of combinations)for(const selected of [null,...flags,'all']){const features={...base,...owner};for(const flag of flags)features[flag]=selected==='all'||selected===flag;const prior=formats.configurationCatalogueGeneration(features),db=database(prior);await formats.requireWindowCalculations(db);assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...formats.configurationCatalogueFeatures(prior),windowCalculations:true});await formats.requireWindowCalculations(db);assert.equal(db.version,prior+bit);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);}
 const payload=seal(Buffer.from('Explicit row window interpretation'),randomBytes(32),'test'),source=database(bit+122,{payload}),chunks=[];await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,source.version);assert.equal(formats.catalogueRequiresDatasetResourcePolicies(restored.version),false);await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});


test('figure projection policies preserve all prior features and independent archive restoration',async()=>{
 const bit=50331648,base=formats.configurationCatalogueFeatures(122),flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations','figureAuthoring','intervalUncertainty','datasetResourcePolicies','windowCalculations'];
 for(const owner of combinations)for(const selected of [null,...flags,'all']){const features={...base,...owner};for(const flag of flags)features[flag]=selected==='all'||selected===flag;const prior=formats.configurationCatalogueGeneration(features),db=database(prior);await formats.requireFigureProjectionPolicies(db);assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...formats.configurationCatalogueFeatures(prior),figureProjectionPolicies:true});await formats.requireFigureProjectionPolicies(db);assert.equal(db.version,prior+bit);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);}
 const payload=seal(Buffer.from('Self-contained affine resource policy'),randomBytes(32),'test'),source=database(bit+122,{payload}),chunks=[];await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,source.version);assert.equal(formats.catalogueRequiresWindowCalculations(restored.version),false);assert.equal(formats.catalogueRequiresDatasetResourcePolicies(restored.version),false);await assert.rejects(formats.catalogueFormat(database((formats.CATALOGUE_MAX_GENERATION+1))),{code:'CATALOGUE_DAMAGED'});
});

test('calculator dataset recipes preserve all earlier capabilities and exact archive restoration',async()=>{
 const bit=100663296,base=formats.configurationCatalogueFeatures(122),flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations','figureAuthoring','intervalUncertainty','datasetResourcePolicies','windowCalculations','figureProjectionPolicies'];
 for(const owner of combinations)for(const selected of [null,...flags,'all']){const features={...base,...owner};for(const flag of flags)features[flag]=selected==='all'||selected===flag;const prior=formats.configurationCatalogueGeneration(features),db=database(prior);await formats.requireCalculatorDatasetResults(db);assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...formats.configurationCatalogueFeatures(prior),calculatorDatasetResults:true});await formats.requireCalculatorDatasetResults(db);assert.equal(db.version,prior+bit);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);}
 const payload=seal(Buffer.from('Exact selected calculator recipe'),randomBytes(32),'test'),source=database(bit+122,{payload}),chunks=[];await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,source.version);assert.equal(formats.catalogueRequiresFigureProjectionPolicies(restored.version),false);assert.equal(formats.catalogueRequiresCalculationPolicies(restored.version),false);await assert.rejects(formats.catalogueFormat(database(formats.CATALOGUE_MAX_GENERATION+1)),{code:'CATALOGUE_DAMAGED'});
});


test('measurement scalar policies preserve independent generations and exact archive restoration',async()=>{
 const bit=201326592,base=formats.configurationCatalogueFeatures(122),flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations','figureAuthoring','intervalUncertainty','datasetResourcePolicies','windowCalculations','figureProjectionPolicies','calculatorDatasetResults'];
 for(const owner of combinations)for(const selected of [null,...flags,'all']){const features={...base,...owner};for(const flag of flags)features[flag]=selected==='all'||selected===flag;const prior=formats.configurationCatalogueGeneration(features),db=database(prior);await formats.requireMeasurementScalarPolicies(db);assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...formats.configurationCatalogueFeatures(prior),measurementScalarPolicies:true});await formats.requireMeasurementScalarPolicies(db);assert.equal(db.version,prior+bit);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);}
 const payload=seal(Buffer.from('Owned exact scalar interpretations'),randomBytes(32),'test'),source=database(bit+122,{payload}),chunks=[];await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,source.version);assert.equal(formats.catalogueRequiresCalculatorDatasetResults(restored.version),false);assert.equal(formats.catalogueRequiresFigureProjectionPolicies(restored.version),false);await assert.rejects(formats.catalogueFormat(database(formats.CATALOGUE_MAX_GENERATION+1)),{code:'CATALOGUE_DAMAGED'});
});


test('exact domain algebra preserves prior policy features and independent archive recovery',async()=>{
 const bit=402653184,base=formats.configurationCatalogueFeatures(122),flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations','figureAuthoring','intervalUncertainty','datasetResourcePolicies','windowCalculations','figureProjectionPolicies','calculatorDatasetResults','measurementScalarPolicies'];
 for(const owner of combinations)for(const selected of [null,...flags,'all']){const features={...base,...owner};for(const flag of flags)features[flag]=selected==='all'||selected===flag;const prior=formats.configurationCatalogueGeneration(features),db=database(prior);await formats.requireDomainAlgebra(db);assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...formats.configurationCatalogueFeatures(prior),domainAlgebra:true});await formats.requireDomainAlgebra(db);assert.equal(db.version,prior+bit);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);}
 for(const domainAlgebra of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...base,domainAlgebra}),{code:'INVALID'});
 const payload=seal(Buffer.from('Exact domain algebra and whole-cell lineage'),randomBytes(32),'test'),source=database(bit+122,{payload}),chunks=[];await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,source.version);assert.equal(formats.catalogueRequiresMeasurementScalarPolicies(restored.version),false);assert.equal(formats.catalogueRequiresCalculatorDatasetResults(restored.version),false);await assert.rejects(formats.catalogueFormat(database(formats.CATALOGUE_MAX_GENERATION+1)),{code:'CATALOGUE_DAMAGED'});
});

test('structured calculator policies preserve independent module and recipe recovery',async()=>{
 const bit=805306368,base=formats.configurationCatalogueFeatures(122),flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations','figureAuthoring','intervalUncertainty','datasetResourcePolicies','windowCalculations','figureProjectionPolicies','calculatorDatasetResults','measurementScalarPolicies','domainAlgebra'];
 for(const owner of combinations)for(const selected of [null,...flags,'all']){const features={...base,...owner};for(const flag of flags)features[flag]=selected==='all'||selected===flag;const prior=formats.configurationCatalogueGeneration(features),db=database(prior);await formats.requireStructuredCalculator(db);assert.equal(db.version,prior+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...formats.configurationCatalogueFeatures(prior),structuredCalculator:true});await formats.requireStructuredCalculator(db);assert.equal(db.version,prior+bit);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);}
 for(const structuredCalculator of [null,1,'true',{}])assert.throws(()=>formats.configurationCatalogueGeneration({...base,structuredCalculator}),{code:'INVALID'});
 const payload=seal(Buffer.from('Structured calculator recipe and module history'),randomBytes(32),'test'),source=database(bit+122,{payload}),chunks=[];await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,source.version);assert.equal(formats.catalogueRequiresMeasurementScalarPolicies(restored.version),false);assert.equal(formats.catalogueRequiresCalculatorDatasetResults(restored.version),false);await assert.rejects(formats.catalogueFormat(database(formats.CATALOGUE_MAX_GENERATION+1)),{code:'CATALOGUE_DAMAGED'});
});


test('physical bigint format text is normalized locally without weakening manifest generations',async()=>{
 for(const generation of [3,49,50,73,74,121,122,formats.CATALOGUE_MAX_GENERATION]){
  assert.equal(await formats.catalogueFormat(database(generation)),generation);
  assert.equal(await formats.catalogueFormat(database(String(generation))),generation);
 }
 for(const invalid of [null,true,false,{},[],3n,NaN,Infinity,3.5,0,-3,'',' 3','3 ','+3','03','3.0','3e0','0x3','9007199254740992','9007199254740993',Number.MAX_SAFE_INTEGER+1,formats.CATALOGUE_MAX_GENERATION+1,String(formats.CATALOGUE_MAX_GENERATION+1)])await assert.rejects(formats.catalogueFormat(database(invalid)),{code:'CATALOGUE_DAMAGED'});
 assert.equal(formats.configurationCatalogueFeatures('122'),null);
 await assert.rejects(formats.restoreConfigurationCatalogueFormat(database(3),'122'),{code:'CATALOGUE_DAMAGED'});
 const generation=formats.configurationCatalogueGeneration({...formats.configurationCatalogueFeatures(122),structuredCalculator:true}),payload=seal(Buffer.from('Canonical numeric archive generation'),randomBytes(32),'test'),source=database(String(generation),{payload}),chunks=[];
 await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});
 const archive=chunks.join(''),header=JSON.parse(archive.slice(0,archive.indexOf('\n')));
 assert.equal(header.catalogueVersion,generation);
 const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(archive)]),restored,{state:['slot','payload']});assert.equal(restored.version,generation);
 header.catalogueVersion=String(header.catalogueVersion);
 await assert.rejects(readCatalogueStream(Readable.from([Buffer.from(JSON.stringify(header)+archive.slice(archive.indexOf('\n')))]),database(3),{state:['slot','payload']}),{code:'CATALOGUE_DAMAGED'});
});


test('approximate calculator generations preserve prior flags across int4 and archive boundaries',async()=>{
 const bit=1610612736,base=formats.configurationCatalogueFeatures(122),flags=['publication','transfers','permissions','sourceSelections','nestedAttempts','ownerDirectories','portability','templateInheritance','pagedResearchTables','nativeNumericalModels','nativeClockModels','retainedFigures','referencedCalculations','reviewFigurePackages','nativeDomainValues','calculationPolicies','clockDerivations','figureAuthoring','intervalUncertainty','datasetResourcePolicies','windowCalculations','figureProjectionPolicies','calculatorDatasetResults','measurementScalarPolicies','domainAlgebra','structuredCalculator'];
 for(const prior of [base,...flags.map(flag=>({...base,[flag]:true})),Object.fromEntries(Object.entries({...base,...Object.fromEntries(flags.map(flag=>[flag,true]))}))]){
  const before=formats.configurationCatalogueGeneration(prior),db=database(before),statements=[],run=db.run.bind(db);db.run=async(sql,...args)=>{statements.push(sql);return run(sql,...args);};
  await formats.requireApproximateCalculator(db);assert.equal(db.version,before+bit);assert.deepEqual(formats.configurationCatalogueFeatures(db.version),{...prior,approximateCalculator:true});
  assert.equal(statements.includes('ALTER TABLE catalogue_format ALTER COLUMN version TYPE bigint'),db.version>2147483647);const restored=database(3);await formats.restoreConfigurationCatalogueFormat(restored,db.version);assert.equal(restored.version,db.version);
 }
 const low=database(3),statements=[],run=low.run.bind(low);low.run=async(sql,...args)=>{statements.push(sql);return run(sql,...args);};await formats.requireStructuredCalculator(low);assert.equal(statements.some(sql=>sql.includes('TYPE bigint')),false);
 const generation=formats.configurationCatalogueGeneration({...base,structuredCalculator:true,approximateCalculator:true}),payload=seal(Buffer.from('Finite approximation with exact pinned recipe'),randomBytes(32),'test'),source=database(String(generation),{payload}),chunks=[];
 await writeCatalogueArchive(source,{writeFile:async text=>chunks.push(text)},{state:['slot','payload']},{observe:false});const restored=database(3);await readCatalogueStream(Readable.from([Buffer.from(chunks.join(''))]),restored,{state:['slot','payload']});assert.equal(restored.version,generation);assert.ok(generation>2147483647);assert.equal(formats.catalogueRequiresMeasurementScalarPolicies(restored.version),false);assert.equal(formats.catalogueRequiresDomainAlgebra(restored.version),false);
});
