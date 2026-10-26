import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {catalogueFormat,catalogueRequiresDomains,catalogueRequiresSettings,catalogueRequiresWebsites,catalogueRequiresStagedEvidence,catalogueRequiresWebsiteEditor,catalogueRequiresWebsitePresentation,requireStagedEvidence,requireProjectDomains,requireWorkspaceDomains,requireWorkspaceSettings,requireWebsiteDocuments,requireRecordResultIndexes,requireWebsiteEditor,requireWebsitePresentation} from '../src/catalogue-format.js';
import {writeCatalogueArchive,readCatalogueArchive} from '../src/postgres-archive.js';
import {seal} from '../src/encryption.js';
import {readProjectDomainRegistry} from '../src/project-domain-registry.js';
import {workspaceSettingsRegistry} from '../src/workspace-settings.js';

function catalogue(version){
 return {version,retiredIndex:version>=23,
  async all(sql){assert.match(sql,/^SELECT version FROM catalogue_format(?: FOR UPDATE NOWAIT)?$/);return [{version:this.version}];},
  async get(sql,slot){if(sql.startsWith('SELECT pg_catalog.format_type'))return null;assert.equal(sql,'SELECT 1 FROM state WHERE slot=$1');assert.equal(slot,'project-domains');return null;},
  async run(sql,...values){
   if(/^(?:SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) catalogue_feature_admission$/.test(sql))return;
   if(sql.startsWith('CREATE INDEX records_scope_revision')){assert.equal(this.retiredIndex,false,'The retained scope index must not be recreated');this.retiredIndex=true;}
   else if(sql.startsWith('UPDATE catalogue_format'))this.version=Math.max(this.version,values[0]);
   else assert.ok(sql.startsWith('ALTER TABLE catalogue_format'),sql);
  }
 };
}
const ownership=version=>[catalogueRequiresDomains(version),catalogueRequiresSettings(version),catalogueRequiresStagedEvidence(version)];
test('selected website presentation admission preserves all independent owners in either order',async()=>{
 for(let before=3;before<=49;before++){
  const db=catalogue(before),prior=ownership(before),expected=(prior[2]?47:44)+(prior[1]?2:prior[0]?1:0);
  await requireWebsitePresentation(db);assert.equal(await catalogueFormat(db),expected);assert.deepEqual(ownership(db.version),prior);assert.equal(db.retiredIndex,true);
  assert.equal(catalogueRequiresWebsiteEditor(db.version),true);assert.equal(catalogueRequiresWebsites(db.version),true);assert.equal(catalogueRequiresWebsitePresentation(db.version),true);
  for(const admit of [requireWebsitePresentation,requireWebsiteEditor,requireWebsiteDocuments,requireRecordResultIndexes]){await admit(db);assert.equal(db.version,expected);}
 }
 for(const stagedFirst of [false,true]){
  const legacy=catalogue(23);legacy.get=async(sql,slot)=>{if(sql.startsWith('SELECT pg_catalog.format_type'))return null;assert.equal(sql,'SELECT 1 FROM state WHERE slot=$1');assert.equal(slot,'project-domains');return {found:1};};
  if(stagedFirst)await requireStagedEvidence(legacy);await requireWebsitePresentation(legacy);if(!stagedFirst)await requireStagedEvidence(legacy);
  assert.equal(legacy.version,48);assert.deepEqual(ownership(legacy.version),[true,false,true]);
 }
 for(const domain of [null,requireProjectDomains,requireWorkspaceDomains,requireWorkspaceSettings])for(const staged of [false,true])for(const presentationFirst of [false,true]){
  const db=catalogue(3);if(presentationFirst)await requireWebsitePresentation(db);if(domain)await domain(db);if(staged)await requireStagedEvidence(db);if(!presentationFirst)await requireWebsitePresentation(db);
  assert.equal(db.version,(staged?47:44)+(domain===requireWorkspaceSettings?2:domain?1:0));
  assert.deepEqual(ownership(db.version),[!!domain,domain===requireWorkspaceSettings,staged]);
 }
 for(const format of [45,46,48,49]){
  const db=catalogue(format);db.get=async()=>null;const store={db,workspace:{},async snapshot(){return {metadata:{id:randomUUID()}};}};
  await assert.rejects(readProjectDomainRegistry(store),{code:'CATALOGUE_DAMAGED'});
  if(catalogueRequiresSettings(format))await assert.rejects(workspaceSettingsRegistry(store),{code:'CATALOGUE_DAMAGED'});
 }
});

test('presentation archives retain capability combinations and reject downgraded ownership declarations',async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-presentation-archive-'));
 t.after(async()=>{assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-presentation-archive-'));await rm(directory,{recursive:true,force:true,maxRetries:5});});
 const file=path.join(directory,'catalogue.archive'),payload=seal(Buffer.from('Synthetic website presentation catalogue state'),randomBytes(32),'qualification'),tables={state:['slot','payload']};
 for(const format of [44,45,46,47,48,49]){
  const db=catalogue(format),domains=catalogueRequiresDomains(format)?['calculator']:[],restored=[];db.id=randomUUID();db.schema='obs_'+db.id.replaceAll('-','');let selected=db.schema;
  const all=db.all,run=db.run,get=db.get;
  db.get=async function(sql,...args){if(sql==="SELECT 1 FROM state WHERE slot='head'")return {found:1};return get.call(db,sql,...args);};
  db.all=async function(sql,...args){if(sql.startsWith('SELECT nspname FROM pg_catalog.pg_namespace '))return domains.map(domain=>({nspname:'obm_'+db.id.replaceAll('-','')+'_'+domain}));if(sql.startsWith('SELECT slot,payload FROM state'))return [{slot:'head',payload}];return all.call(db,sql,...args);};
  db.rows=async function*(sql){if(this.schema===db.schema&&sql.includes(' FROM state '))yield {slot:'head',payload_bytes:payload.length};};
  db.run=async function(sql,...args){if(sql.startsWith('SET LOCAL search_path')){selected=sql.split('"')[1];return;}if(sql.startsWith('CREATE SCHEMA')||sql.startsWith('REVOKE ')||sql.startsWith('CREATE TABLE domain_format'))return;if(sql.startsWith('INSERT INTO state')){restored.push({schema:selected,values:args});return;}return run.call(db,sql,...args);};
  const handle=await open(file,'w');try{await writeCatalogueArchive(db,handle,tables);}finally{await handle.close();}
  const raw=await readFile(file,'utf8'),lines=raw.trimEnd().split('\n'),header=JSON.parse(lines[0]);assert.deepEqual(header,{format:'observanda-postgresql-archive',version:12,catalogueVersion:format,domains});
  db.version=3;db.retiredIndex=false;await readCatalogueArchive(file,db,tables);assert.equal(db.version,format);assert.deepEqual(restored,[{schema:db.schema,values:['head',payload]}]);
  for(const bad of [{...header,version:11},{...header,catalogueVersion:43},{...header,domains:domains.length?[]:['calculator']}]){
   await writeFile(file,JSON.stringify(bad)+'\n'+lines.slice(1).join('\n')+'\n');await assert.rejects(readCatalogueArchive(file,db,tables),{code:'CATALOGUE_DAMAGED'});
  }
 }
});
