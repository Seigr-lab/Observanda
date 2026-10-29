// An encrypted module owner has no research snapshots or research writer.
// Its key and authenticated names bind it to this project and feature domain.
import {moduleDomainKeyScope} from './module-domain-owner.js';
import {hkdfSync} from 'node:crypto';
import {seal,unseal} from './encryption.js';
import {ObjectIndex} from './object-index.js';
import {verifiedCatalogueObjects} from './catalogue-object-verification.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {validModuleDomain,moduleDomain} from './modules/domains.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
export class ProjectDomainCatalogue{
 constructor(workspace,db,domain,namespaceId,{writable=false,catalogueDb=null,readOnly=false}={}){
  if(!workspace.vault?.key||!validModuleDomain(domain)||typeof readOnly!=='boolean'||readOnly&&writable)throw new AppError('INVALID');
  this.workspace=workspace;this.db=db;this.catalogueDb=catalogueDb;this.domain=domain;this.namespaceId=namespaceId;this.writable=writable;
  this.readOnly=readOnly;this.readCache=readOnly?new CatalogueReadCache():null;
  this.scope=moduleDomainKeyScope(workspace,namespaceId);
  this.key=Buffer.from(hkdfSync('sha256',workspace.vault.key,this.scope.salt,this.scope.label+'/'+workspace.vault.id+'/'+domain,32));
 }
 assertModuleType(type){if(moduleDomain(type)!==this.domain)throw new AppError('MODULE_FORMAT');}
 assertModuleWrite(entities,event){if(!this.writable)throw new AppError('INVALID');for(const e of [...entities,...event.changes])this.assertModuleType(e.type);}
 close(){this.readCache?.clear();this.key.fill(0);this.closed=true;}
 aad(table,id){return JSON.stringify([this.scope.label,this.workspace.vault.id,this.scope.identity,this.namespaceId,this.domain,table,id]);}
 encode(table,id,value){if(this.closed)throw new AppError('ACCESS_LOCKED');return seal(Buffer.from(serialize(value)),this.key,this.aad(table,id));}
 decode(table,id,bytes){
  if(this.closed)throw new AppError('ACCESS_LOCKED');if(!bytes)throw new AppError('CATALOGUE_DAMAGED');
  try{return JSON.parse(unseal(Buffer.from(bytes),this.key,this.aad(table,id)).toString('utf8'));}
  catch(error){if(error instanceof AppError)throw error;throw new AppError('CATALOGUE_DAMAGED');}
 }
 async objectValue(id,expected){
  const load=()=>this.db.get('SELECT payload FROM objects WHERE id=$1',id),row=this.readCache?await this.readCache.row('object:'+id,load):await load();
  if(!!row!==!!expected)throw new AppError('CATALOGUE_DAMAGED');if(!row)return null;
  const value=this.decode('object',id,row.payload);if(digest(serialize(value))!==expected.revision)throw new AppError('CATALOGUE_DAMAGED');return value;
 }
 async object(id){const index=new ObjectIndex(this),head=await index.head();return this.objectValue(id,await index.find(head,id));}
 async putObject(id,value){
  if(!this.writable)throw new AppError('INVALID');const index=new ObjectIndex(this),head=await index.head(),expected=await index.find(head,id),revision=digest(serialize(value));
  await this.objectValue(id,expected);if(expected?.revision===revision)return;
  await index.update(head,id,revision);
  await this.db.run('INSERT INTO objects VALUES ($1,$2)'+(expected?' ON CONFLICT(id) DO UPDATE SET payload=excluded.payload':''),id,this.encode('object',id,value));
 }
 async deleteObject(id){
  if(!this.writable)throw new AppError('INVALID');
  const index=new ObjectIndex(this),head=await index.head(),expected=await index.find(head,id);
  await this.objectValue(id,expected);if(!expected)return;
  // update() invalidates any transaction read cache along with the index head.
  await index.update(head,id,null);await this.db.run('DELETE FROM objects WHERE id=$1',id);
 }
 async *objectIdEntries(prefix,{signal}={}){
  const index=new ObjectIndex(this),head=await index.head();
  for await(const entry of index.entries(head,prefix)){signal?.throwIfAborted();yield entry.id;}
 }
 verifiedObjects(){return verifiedCatalogueObjects(this);}
}
