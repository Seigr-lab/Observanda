import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {Workspace} from '../src/storage.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchTransfer} from '../src/collaboration/research-transfer.js';
import {ExchangeParts} from '../src/collaboration/exchange-parts.js';
import {contentBuffer} from '../src/file-content.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankQuantity,blankClock} from '../src/web/measurement-model.js';
import {blankUnitDefinition} from '../src/web/measurement-unit-model.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {resolveScalarDefinitions} from '../src/measurement-scalar-storage.js';
import {domainValuePage,readDomainComponent} from '../src/measurement-domain-storage.js';
const scalar=spelling=>({spelling,representation:'integer',radix:10});
const quote=value=>'"'+value.replaceAll('"','""')+'"';
function policy(){const value=defaultDatasetResourcePolicy();value.resources.maxScalarCharacters=12000;value.resources.maxOperations=200000;return value;}
test('selected shared package preserves policy scalar and domain text closure under independent keys',{timeout:180000},async t=>{
 const f=await collaborationFixture(t),m=new ResearchMaterials(f.author.workspace),recordId=f.book.entries[0].id,spelling='0'.repeat(9000)+'1',modulus='0'.repeat(9000)+'7',domain={...defaultDomain('vector'),version:2,resourcePolicy:policy()},original=Buffer.from('Counter,Vector\n2,'+quote(JSON.stringify([spelling,'2']))+'\n');
 const stage=message=>process.stdout.write('# '+message+'\n');
 const upload=await m.startImport({recordId,name:'policy-source.csv',size:original.length});await m.appendImport(upload.id,0,[original]);const artifact=await m.finishImport(upload.id),raw=await m.dataset({recordId,title:'Original exact text',artifact}),rawDoc=await m.read(raw);
 const quantity={...blankQuantity(),unitDefinition:{...blankUnitDefinition(),version:2,resourcePolicy:policy(),scale:scalar(spelling)}},time={kind:'counter',reference:'',resolution:'',uncertainty:'',clock:{...blankClock(),definition:{version:2,resourcePolicy:policy(),modulus:scalar(modulus),rate:null}}},columns=[{...defaultColumn({label:'Counter'}),representation:'integer',quantity,time},{...defaultColumn({label:'Vector'}),representation:'domain',domain}];
 const dataset=await m.dataset({recordId,title:'Declared scalar source',id:raw.id,expectedRevision:raw.revision,artifact,baseDataset:raw,sourceMapping:rawDoc.content.sourceMapping,columnChanges:columns.map((column,index)=>({index,column}))},{signal:t.signal});
 const measurement={version:2,resourcePolicy:policy(),value:{...scalar(spelling),unit:'count',presence:'value'},quantity:blankQuantity(),time:{kind:'none',reference:'',resolution:'',uncertainty:''},sources:[{ref:artifact,selector:{kind:'whole'}}],references:{decoder:null,schema:null},decoderVersion:'',integrity:'unknown',completion:'unknown',note:'Exact declared spelling.'};
 const observed=await m.measurements.save({recordId,title:'Retained standalone scalar',measurement},{signal:t.signal}),privateUpload=await m.startImport({recordId:f.book.entries[2].id,name:'not-selected.txt',size:9});await m.appendImport(privateUpload.id,0,[Buffer.from('unrelated')]);const hidden=await m.finishImport(privateUpload.id);
 const sourceDoc=await m.read(dataset),sourceSchema=await m.retainedSchemaPage(sourceDoc),unitRef=sourceSchema.items[0].quantity.unitDefinition.scale.spelling;assert.equal(sourceDoc.content.schemaIndex.kind,'columns-policy');assert.equal(unitRef.format,'dataset-cell');stage('Declared schema, component and standalone scalar authored.');
 const offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),parts=new ExchangeParts(f.author.workspace,offer.id);await parts.open();assert.equal(await parts.descriptor('metadata','.observanda/materials/objects/'+hidden.id+'/'+hidden.revision+'.json'),null);
 const incoming=await f.sb.receive(await f.sa.outgoing(offer.id)),destination=path.join(f.directory,'scalar-shared-copy');await f.sb.acceptCopy(incoming.id,destination);
 const vault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);assert.notEqual(vault.id,f.author.vault.id);const workspace=new Workspace(destination,vault),copied=new ResearchMaterials(workspace);
 await workspace.withCatalogueConnections(async()=>{
  const doc=await copied.read(dataset),stored=await copied.retainedSchemaPage(doc),resolved=await resolveScalarDefinitions(copied,stored.items[0]);assert.equal(resolved.quantity.unitDefinition.scale.spelling,spelling);assert.equal(resolved.time.clock.definition.modulus.spelling,modulus);assert.deepEqual(stored.items[0],sourceSchema.items[0]);
  assert.equal(stored.items[0].quantity.unitDefinition.scale.spelling.sha256,createHash('sha256').update(spelling,'utf16le').digest('hex'));
  const value=(await copied.retainedDatasetPage(doc,0,{columns:[1]})).rows[0].cells[0];assert.equal(value.version,3);assert.equal((await domainValuePage(copied,value,{limit:1,resolve:true})).items[0].exact,'1/1');assert.equal((await readDomainComponent(copied,value,{component:0,offset:8998,limit:3})).text,'001');
  assert.deepEqual(await resolveScalarDefinitions(copied,(await copied.read(observed)).content.measurement),measurement);assert.deepEqual(await contentBuffer((await copied.artifact(artifact)).content),original);assert.equal(await copied.current(hidden.id),null);
 });stage('Authenticated selected package reopened with complete spellings and no unrelated material.');
 const root=await copied.sequences.tree().node(unitRef.parts.root),relative='.observanda/materials/sequences/chunks/'+root.revision+'.json',text=await workspace.readMetadata(relative);
 await workspace.withLock(()=>workspace.catalogue(store=>store.deleteObject('metadata:'+relative)));
 try{
  await assert.rejects(resolveScalarDefinitions(copied,sourceSchema.items[0]),{code:'MATERIAL_MISSING'});
  await assert.rejects(new ResearchTransfer(workspace,new Set(),[],()=>{}).sequence(sourceDoc.content.schemaIndex),{code:'MATERIAL_MISSING'});
 }finally{await workspace.withLock(()=>workspace.writeMetadata(relative,text));}
 assert.equal((await resolveScalarDefinitions(copied,sourceSchema.items[0])).quantity.unitDefinition.scale.spelling,spelling);stage('Missing required text refuses interpretation and transfer; restoring exact bytes recovers.');
});
