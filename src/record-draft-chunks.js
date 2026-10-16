import {ObjectIndex,validIndexRef} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from './web/record-draft-protocol.js';
import {researchId} from './web/research-reference.js';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const key=index=>'chunk:'+String(index).padStart(16,'0');
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
// A checkpoint root authenticates each independently readable encrypted block.
// Shared blocks are immutable, including while a replacement is being uploaded.
export class RecordDraftChunks{
 constructor(workspace,id,{starter=false}={}){if(!researchId(id))throw new AppError('INVALID');this.workspace=workspace;this.prefix='.observanda/'+(starter?'record-starter-upload-blocks':'record-draft-blocks')+'/'+id;this.transferRoot='.observanda/'+(starter?'record-starter-uploads':'record-draft-transfers');this.id=id;}
 async read(kind,id,limit){
  if(!hash(id))fail();const raw=await this.workspace.readMetadata(this.prefix+'/'+kind+'/'+id+'.json',limit);if(raw===null)fail();
  let value;try{value=JSON.parse(raw);}catch{fail();}if(digest(serialize(value))!==id)fail();return value;
 }
 async put(kind,value){
  const raw=serialize(value),id=digest(raw),file=this.prefix+'/'+kind+'/'+id+'.json';
  const old=await this.workspace.readMetadata(file,2*SIZE);if(old!==null&&old!==raw)fail();
  if(old===null)await this.workspace.writeMetadata(file,raw);return id;
 }
 tree(){return new ObjectIndex(null,{immutable:true,nodeStorage:{read:async ref=>{const raw=await this.workspace.readMetadata(this.prefix+'/nodes/'+ref.hash+'.json',8192);if(raw===null)return null;let node;try{node=JSON.parse(raw);}catch{fail();}if(digest(serialize(node))!==ref.hash)fail();return node;},write:(ref,node)=>this.put('nodes',node)}});}
 valid(value,{complete=true}={}){
  return value&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&hash(value.sha256)&&validIndexRef(value.root)&&
   (complete?(value.root?.count??0)===Math.ceil(value.bytes/SIZE):(value.root?.count??0)<=Math.ceil(value.bytes/SIZE));
 }
 async add(value,index,bytes){
  if(!this.valid(value,{complete:false})||!Number.isSafeInteger(index)||index<0||index>(value.root?.count??0)||index>=Math.ceil(value.bytes/SIZE)||bytes.length!==Math.min(SIZE,value.bytes-index*SIZE))throw new AppError('INVALID');
  const tree=this.tree(),prior=await tree.find({root:value.root},key(index)),item={index,bytes:bytes.toString('base64')},revision=digest(serialize(item));
  if(prior){if(prior.revision!==revision)throw new AppError('DRAFT_CHANGED');return value;}
  await this.put('chunks',item);const root=await tree.change(value.root,key(index),revision);await tree.flush(root);return {...value,root};
 }
 async part(value,index,{complete=true}={}){
  if(!this.valid(value,{complete})||!Number.isSafeInteger(index)||index<0||index>=(value.root?.count??0))throw new AppError('INVALID');
  const entry=await this.tree().find({root:value.root},key(index));if(!entry)fail();
  const item=await this.read('chunks',entry.revision,2*SIZE);if(item.index!==index||typeof item.bytes!=='string')fail();
  const bytes=Buffer.from(item.bytes,'base64');if(bytes.toString('base64')!==item.bytes||bytes.length!==Math.min(SIZE,value.bytes-index*SIZE))fail();return bytes;
 }
 async *chunks(value,{signal,complete=true}={}){if(!this.valid(value,{complete}))throw new AppError('INVALID');for(let index=0;index<(value.root?.count??0);index++){signal?.throwIfAborted();yield await this.part(value,index,{complete});}}
 // Roots belong to one checkpoint writer. Keep its committed root and in-flight
 // replacement; remove superseded search paths in the same transaction. Index
 // positions participate in chunk hashes, so no other position owns that blob.
 async release(before,keep=[]){
  if(!before)return;const tree=this.tree();
  const retained=async(id,root)=>{let ref=root;while(ref){const node=await tree.node(ref);if(node.id===id)return {ref,node};ref=id<node.id?node.left:node.right;}return null;};
  const visit=async ref=>{
   if(!ref)return;const node=await tree.node(ref),matches=[];
   for(const root of keep)matches.push(await retained(node.id,root));
   if(matches.some(match=>match?.ref.hash===ref.hash))return;
   await visit(node.left);await visit(node.right);
   if(!matches.some(match=>match?.node.revision===node.revision))await this.workspace.removeMetadata(this.prefix+'/chunks/'+node.revision+'.json');
   await this.workspace.removeMetadata(this.prefix+'/nodes/'+ref.hash+'.json');
  };await visit(before);
 }
 async clear(){
  for(const kind of ['nodes','chunks'])for await(const name of this.workspace.metadataNames(this.prefix+'/'+kind)){
   if(!/^[a-f0-9]{64}\.json$/.test(name))fail();await this.workspace.removeMetadata(this.prefix+'/'+kind+'/'+name);
  }
  // An ordinary checkpoint has no staged transfer. Filesystem workspaces,
  // unlike catalogue objects, report its absence while removing metadata.
  try{await this.workspace.removeMetadata(this.transferRoot+'/'+this.id+'.json');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
