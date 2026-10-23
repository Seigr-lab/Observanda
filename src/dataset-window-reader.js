import {AppError} from './errors.js';
import {DATASET_ROWS_PER_PAGE} from './dataset-row-position.js';
import {revisionText} from './web/revision-model.js';
import {validWindow,windowDisposition} from './web/dataset-window-model.js';
const fail=()=>{throw new AppError('DATASET_WINDOW_INVALID');};
// A bounded page cache is scoped to one evaluation; admission is rechecked for every operation.
export class DatasetWindowReader{
 constructor(materials){this.materials=materials;this.pages=new Map();this.key=null;}
 async open(node,binding,location,{signal}={}){
  if(!validWindow(node.window,node.operation)||binding.source.kind!=='dataset')fail();const m=this.materials,doc=await m.read(binding.source);if(!Number.isSafeInteger(doc.content.rowCount)||doc.content.rowCount<0)fail();const key=revisionText([binding.source,node.column]);if(this.key!==key){this.key=key;this.pages.clear();}
  const page=async index=>{signal?.throwIfAborted();let data=this.pages.get(index);if(!data){data=await m.retainedDatasetPage(doc,index,{columns:[node.column]});if(this.pages.size===3)this.pages.delete(this.pages.keys().next().value);this.pages.set(index,data);}return data;};
  if(!location)return {doc,anchor:null,total:0,async at(){return {boundary:true,unmatched:true,value:'',kind:'absent',excluded:null};}};
  if(location.kind!=='dataset')fail();const current=(await page(location.page)).rows[location.row];if(!current||current.id!==location.id||(current.excluded??null)!==(location.excluded??null))fail();
  let anchor=location.row;if(doc.content.datasetFormat===3)anchor+=location.page*DATASET_ROWS_PER_PAGE;else for(let p=0;p<location.page;p++)anchor+=(await page(p)).rows.length;
  const start=anchor+node.window.start,end=anchor+node.window.end;if(!Number.isSafeInteger(anchor)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end))fail();
  return {doc,anchor,total:node.window.end-node.window.start+1,async at(index){
   signal?.throwIfAborted();if(!Number.isSafeInteger(index)||index<0||index>node.window.end-node.window.start)fail();const ordinal=start+index;if(!Number.isSafeInteger(ordinal))fail();if(ordinal<0||ordinal>=doc.content.rowCount)return {boundary:true,ordinal,value:'',kind:'absent',excluded:null};
   let address=doc.content.datasetFormat===3?{page:Math.floor(ordinal/DATASET_ROWS_PER_PAGE),row:ordinal%DATASET_ROWS_PER_PAGE}:null;if(!address){let left=ordinal;for(let p=0;p<m.datasetPageCount(doc);p++){const data=await page(p);if(left<data.rows.length){address={page:p,row:left};break;}left-=data.rows.length;}}
   if(!address)fail();const row=(await page(address.page)).rows[address.row];if(!row)fail();return {value:row.cells[0],kind:row.valueKinds?.[0]??'string',excluded:row.excluded,ordinal,id:row.id,source:{ref:binding.source,selector:{kind:'cell',page:address.page,row:address.row,column:node.column}}};
  }};
 }
}
export async function windowSourcePage(materials,node,binding,location,column,{offset=0,limit=16,signal}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>16)throw new AppError('INVALID');const reader=await new DatasetWindowReader(materials).open(node,binding,location,{signal}),total=reader.total;if(offset>total&&offset!==0)throw new AppError('INVALID');const items=[];for(let index=offset;index<Math.min(total,offset+limit);index++){const cell=await reader.at(index),status=windowDisposition(cell,column,node.window);items.push({relativeRow:node.window.start+index,ordinal:cell.ordinal,...status,excluded:cell.excluded,source:cell.source??null});}return {items,total,offset,previous:offset?Math.max(0,offset-limit):null,next:offset+items.length<total?offset+items.length:null};
}
