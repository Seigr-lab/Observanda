// Runs the stored three-way record merge on plain records, the way draft
// recovery reviews them: each overlapping change is a decision for `choose`.
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordDocument} from '../src/record-document.js';
import {mergeRecordDocuments} from '../src/record-document-merge.js';
import {digest,serialize} from '../src/storage-format.js';
function memory(){const nodes=new Map();return {async put(kind,value){const raw=serialize(value),revision=digest(raw);nodes.set(kind+revision,raw);return revision;},async read(kind,revision){return JSON.parse(nodes.get(kind+revision));},tree(){return new RecordValueTree(this);}};}
// `choose` receives {path,base,mine,stored} with plain values and returns 'mine' or 'stored'.
export async function mergeRecords(base,mine,stored,{choose=()=>'stored'}={}){
 const blocks=memory(),tree=blocks.tree(),retain=value=>value==null?null:tree.retain(value),[b,m,s]=await Promise.all([base,mine,stored].map(retain)),conflicts=[];
 const read=ref=>ref===null?undefined:tree.read(ref);
 const merged=await mergeRecordDocuments(new RecordDocument(blocks,s??m,{mutable:true}),{base:b,mine:m,stored:s,choose:async item=>{
  const conflict={path:item.path,base:await read(item.base),mine:await read(item.mine),stored:await read(item.stored)};conflicts.push(conflict);return item[await choose(conflict)];
 }});
 return {record:merged?await tree.read(merged.root):null,conflicts};
}
