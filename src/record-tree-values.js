// Compose counted JSON containers from retained child references. The child
// iterator owns validation; this owner never materializes their content.
import {RetainedTableIndex} from './retained-table-index.js';
import {AppError} from './errors.js';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export async function retainRecordContainer(storage,type,children,{signal}={}){
 const builder=new RecordContainerBuilder(storage,type);
 for await(const child of children){
  signal?.throwIfAborted();await builder.add(child);
 }
 signal?.throwIfAborted();return builder.finish();
}
export class RecordSequenceBuilder{
 constructor(storage){
  this.storage=storage;this.index=new RetainedTableIndex(storage,{namespace:'index',allowSparseBranches:true});this.levels=[];this.count=0;this.finished=false;
 }
 async emit(level){const ref=this.index.make({[level?'children':'entries']:this.levels[level]});await this.index.flush(ref);this.levels[level]=[];return ref;}
 async append(level,item){(this.levels[level]??=[]).push(item);if(this.levels[level].length===32)await this.append(level+1,await this.emit(level));}
 async addNode(node){
  if(this.finished||!Number.isSafeInteger(this.count+1))throw new AppError('INVALID');
  await this.append(0,{id:String(this.count++).padStart(16,'0'),revision:await this.storage.put('value',node)});
 }
 async finishIndex(){
  if(this.finished)throw new AppError('INVALID');this.finished=true;
  let root=null;
  for(let level=0;level<this.levels.length;level++){
   if(!this.levels[level].length)continue;
   if(level&&this.levels[level].length===1&&!this.levels.slice(level+1).some(items=>items.length)){root=this.levels[level][0];break;}
   const ref=await this.emit(level);if(!this.levels.slice(level+1).some(items=>items.length)){root=ref;break;}await this.append(level+1,ref);
  }
  return root;
 }
}
export class RecordContainerBuilder extends RecordSequenceBuilder{
 constructor(storage,type){
  super(storage);if(!['array','object'].includes(type))throw new AppError('INVALID');this.type=type;
 }
 async add(child){
  if(!child||!hash(child.value)||this.type==='object'&&typeof child.name!=='string')throw new AppError('INVALID');
  return this.addNode(this.type==='array'?{type:'item',value:child.value}:{type:'property',name:child.name,value:child.value});
 }
 async finish(){return this.storage.put('value',{type:this.type,root:await this.finishIndex()});}
}
