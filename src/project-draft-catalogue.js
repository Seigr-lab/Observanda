import {catalogueIndexedCount,cataloguePrefixExists} from './postgres-indexes.js';
// Draft metadata has a separate authenticated tree and writer from saved
// module commands. Its rows share only the domain's encryption/storage owner.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {writeCatalogueRows} from './catalogue-writes.js';
import {moduleDraftDomain} from './modules/draft-domains.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
class DraftObjectIndex extends ObjectIndex{
 constructor(store,options={}){super(store,{...options,namespace:store.nodePrefix});}
 async assertEmpty(){if(await cataloguePrefixExists(this.store.db,'state',this.store.valuePrefix)||await cataloguePrefixExists(this.store.db,'state',this.namespace))fail();}
 async head(){
  const s=this.store,row=await s.db.get('SELECT payload FROM state WHERE slot=$1',s.headSlot);if(!row){await this.assertEmpty();return {formatVersion:2,root:null};}
  const value=s.decode('state',s.headSlot,row.payload);if(!value||Object.keys(value).sort().join()!=='formatVersion,root'||value.formatVersion!==2||!validIndexRef(value.root))fail();if(value.root===null)await this.assertEmpty();return value;
 }
 async persist(root){
  const s=this.store;if(!s.writable)throw new AppError('INVALID');
  function* rows(writes){for(const [key,node] of writes)yield [key,node===null?null:s.encode('state',key,node)];}
  await writeCatalogueRows(s.db,'state',rows(this.writes));await s.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',s.headSlot,s.encode('state',s.headSlot,{formatVersion:2,root}));
  this.cache.clear();this.cachedVersions.clear();this.cacheBytes=0;this.pending.clear();this.pendingBytes=0;this.writes.clear();
 }
 async checkCounts(head){const s=this.store,objects=await catalogueIndexedCount(s.db,'state',s.valuePrefix),nodes=await catalogueIndexedCount(s.db,'state',this.namespace);if(objects!==(head.root?.count??0)||nodes!==(head.root?.count??0))fail();}
}
export class ProjectDraftCatalogue{
 constructor(domain,research,moduleId,{writable=false}={}){
  if(domain.domain!==moduleDraftDomain(moduleId))throw new AppError('INVALID');
  this.owner=domain;this.research=research;this.db=domain.db;this.catalogueDb=domain.catalogueDb;this.moduleId=moduleId;this.writable=writable;
  this.headSlot='module-drafts:'+moduleId;this.nodePrefix=this.headSlot+':index:';this.valuePrefix=this.headSlot+':value:';
 }
 encode(...args){return this.owner.encode(...args);}
 decode(...args){return this.owner.decode(...args);}
 snapshot(){return this.research.snapshot();}
 objectIndex(options){return new DraftObjectIndex(this,options);}
 async objectValue(id,expected){
  const slot=this.valuePrefix+id,row=await this.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(!!row!==!!expected)fail();if(!row)return null;
  const value=this.decode('state',slot,row.payload);if(digest(serialize(value))!==expected.revision)fail();return value;
 }
 async object(id){const index=this.objectIndex(),head=await index.head();return this.objectValue(id,await index.find(head,id));}
 async putObject(id,value){
  if(!this.writable)throw new AppError('INVALID');const index=this.objectIndex(),head=await index.head(),old=await index.find(head,id),revision=digest(serialize(value));await this.objectValue(id,old);if(old?.revision===revision)return;
  await index.update(head,id,revision);const slot=this.valuePrefix+id;await this.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',slot,this.encode('state',slot,value));
 }
 async deleteObject(id){
  if(!this.writable)throw new AppError('INVALID');const index=this.objectIndex(),head=await index.head(),old=await index.find(head,id);await this.objectValue(id,old);if(!old)return;
  await index.update(head,id,null);await this.db.run('DELETE FROM state WHERE slot=$1',this.valuePrefix+id);
 }
}
