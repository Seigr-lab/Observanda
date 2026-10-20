import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {AppError} from './errors.js';
import {RecordDocument} from './record-document.js';
import {preparationCollections} from './web/attempt-model.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const key=(collection,id)=>collection+':'+id;
// Checkpoint-local uniqueness and exact row authentication use the existing
// notebook-key index pages. A header/row edit touches no unrelated row body.
export class PreparationIdentityIndex{
 constructor(document,value){this.document=document;this.index=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});this.value=value;if(!value||!validTableRef(value.root))fail();}
 async find(collection,id){return this.index.find(this.value,key(collection,id));}
 async change(collection,id,revision){this.value.root=await this.index.change(this.value.root,key(collection,id),revision);}
 async remove(collection,id){this.value.root=await this.index.remove(this.value.root,key(collection,id));}
 async flush(source){await this.index.flush(this.value.root);this.value.source=source;return this.value;}
 async verify(reference,{signal}={}){if(reference!==this.value.source)fail();let count=0;
  for(const collection of preparationCollections){const source=await this.document.tree.select(reference,[collection]);if(!source)fail();
   for await(const row of preparationItems(this.document,reference,collection,{signal})){const id=(await this.document.tree.selected(row.value,['id'])).value;if((await this.find(collection,id))?.revision!==row.value)fail();count++;}
  }
  if(count!==(this.value.root?.count??0))fail();for await(const entry of this.index.entries(this.value)){signal?.throwIfAborted();if(!preparationCollections.some(group=>entry.id.startsWith(group+':')))fail();}return true;
 }
 static async build(document,reference,{signal}={}){
  const value={source:reference,root:null},owner=new this(document,value);let pending=0;
  if(reference)for(const collection of preparationCollections)for await(const row of preparationItems(document,reference,collection,{signal})){const id=(await document.tree.selected(row.value,['id'])).value;if(await owner.find(collection,id))fail();await owner.change(collection,id,row.value);if(++pending===32){await owner.index.flush(value.root);pending=0;}}
  await owner.index.flush(value.root);return owner;
 }
}
const preparationItems=(document,reference,collection,options)=>new RecordDocument(document.blocks,reference).items([collection],options);
