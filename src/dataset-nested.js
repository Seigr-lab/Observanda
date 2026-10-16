import {AppError} from './errors.js';
import {scratchIterator} from './scratch-iterator.js';
import {datasetJSONTokens} from './dataset-json-tokens.js';
import {jsonPointerParts as parts,jsonPointer as pointer} from './web/dataset-preparation-model.js';
import {packedPosition} from './dataset-packed.js';
const matches=(pattern,at)=>pattern.length===at.path.length&&pattern.every((p,i)=>p==='*'?at.arrays.includes(i):p===at.path[i]);
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const missing=()=>({value:'',kind:'absent',pointer:null});
const fail=code=>{throw new AppError(code??'MATERIAL_TABLE');};
export function nestedDataset(chunks,mapping,limits,options={}){
 return scratchIterator(async function*(store){
  const rowPattern=parts(mapping.rowsPath),fields=mapping.fields.map(f=>({...f,parts:parts(f.path)}));
  const joins=mapping.joins.map(j=>({...j,pattern:parts(j.rowsPath),left:j.mode==='position'?null:parts(j.leftPath),right:j.mode==='position'?null:parts(j.rightPath)}));
  const rowFields=fields.map((f,i)=>({...f,i})).filter(f=>f.source==='row'),context=fields.filter(f=>f.source==='context');
  const definitions=[{name:'row',pattern:rowPattern,fields:rowFields.map(f=>({...f,key:'field:'+f.i})).concat(joins.filter(j=>j.mode!=='position').map(j=>({parts:j.left,key:'left:'+j.name})))},...joins.map(j=>({...j,fields:[...(j.right?[{parts:j.right,key:'key'}]:[]),...fields.map((f,i)=>({...f,key:'field:'+i})).filter(f=>f.source===j.name)]}))];
  const selected=at=>context.some(f=>matches(f.parts,at))||definitions.some(d=>{const p=d.packed?packedPosition(d,at):null;return d.fields.some(f=>d.packed?p&&same(f.parts,p.relative):matches([...d.pattern,'*',...f.parts],at));});
  const active=new Map(),arrays=new Map(),found=new Set(),positional=joins.filter(j=>j.mode==='position');let count=0,pending=[],pendingBytes=0,arrayCount=0;
  const flush=async()=>{if(pending.length){await store.putMany(pending);pending=[];pendingBytes=0;}};
  const put=async(key,value)=>{pending.push([key,value]);pendingBytes+=JSON.stringify(value).length;if(pending.length===32||pendingBytes>=limits.pageBytes)await flush();};
  const joinKey=(j,path,key)=>JSON.stringify(['join',j.name,j.pattern.flatMap((p,i)=>p==='*'?[path[i]]:[]),key.kind,key.value]);
  const bindings=(pattern,path)=>pattern.flatMap((p,i)=>p==='*'?[path[i]]:[]);
  const positionKey=(name,scope,index)=>JSON.stringify(['position',name,scope,index]);
  const countKey=(name,scope)=>JSON.stringify(['length',name,scope]);
  const finish=async d=>{
   const row=active.get(d.name);active.delete(d.name);
   if(arrays.has(d.name))arrays.get(d.name).length++;
   if(d.name==='row')await put('row:'+count++,row);
   else if(d.mode==='position')await put(positionKey(d.name,bindings(d.pattern,row.path),String(row.position??row.path[d.pattern.length])),row);
   else{
    const key=row.values.key??missing();if(['absent','null'].includes(key.kind))fail('DATASET_JOIN_KEY');
    await flush();if(!await store.add(joinKey(d,row.path,key),row))fail('DATASET_JOIN_DUPLICATE');
   }
  };
  for await(const token of datasetJSONTokens(chunks,selected,limits,options)){
   for(const d of definitions){
    if(matches(d.pattern,token)){
     if(token.event!=='end'){
      if(token.event!=='begin'||token.type!=='array')fail();found.add(d.name);
      if(positional.length&&(d.name==='row'||d.mode==='position'))arrays.set(d.name,{name:d.name,scope:bindings(d.pattern,token.path),pointer:pointer(token.path),length:0,...(d.packed?{sourceLength:0}:{})});
     }else if(arrays.has(d.name)){
      const value=arrays.get(d.name);arrays.delete(d.name);
      if(d.packed&&(value.sourceLength<d.packed.offset+d.packed.width*d.packed.count||value.length!==d.packed.count))throw new AppError('DATASET_PACKED_LENGTH',[{pointer:value.pointer,...d.packed,actual:value.sourceLength}]);
      await put(countKey(d.name,value.scope),value);await put('alignment:'+arrayCount++,value);
     }
    }
    if(d.packed){
     const p=packedPosition(d,token),direct=matches([...d.pattern,'*'],token);
     if(direct&&(token.event==='end'||token.event==='value'))arrays.get(d.name).sourceLength++;
     if(p&&direct&&p.slot===0&&token.event!=='end'){if(active.has(d.name))fail();active.set(d.name,{path:token.path,position:p.record,values:{},chars:0});}
     const row=active.get(d.name);
     if(p&&row&&token.event==='value')for(const f of d.fields)if(same(f.parts,p.relative)){row.chars+=token.value.length;if(row.chars>limits.rowChars)fail();row.values[f.key]={value:token.value,kind:token.kind,pointer:pointer(token.path)};}
     if(p&&direct&&p.slot===d.packed.width-1&&(token.event==='end'||token.event==='value'))await finish(d);
     continue;
    }
    if(token.event!=='end'&&matches([...d.pattern,'*'],token)){
     if(active.has(d.name))fail();active.set(d.name,{path:token.path,values:{},chars:0});
    }
    const row=active.get(d.name);
    if(row&&token.event==='value')for(const f of d.fields)if(same([...row.path,...f.parts],token.path)){
     row.chars+=token.value.length;if(row.chars>limits.rowChars)fail();row.values[f.key]={value:token.value,kind:token.kind,pointer:pointer(token.path)};
    }
    if(row&&(token.event==='end'||token.event==='value')&&same(row.path,token.path))await finish(d);
   }
   if(token.event==='value'&&context.some(f=>matches(f.parts,token)))await put('context:'+pointer(token.path),{value:token.value,kind:token.kind,pointer:pointer(token.path)});
  }
  await flush();
  // Validate every concrete array, including empty windows and extra controls,
  // before emitting any result. Each wildcard denotes the same source parent.
  for(let i=0;i<arrayCount;i++){
   options.signal?.throwIfAborted();const array=await store.get('alignment:'+i),row=array.name==='row'?array:await store.get(countKey('row',array.scope));
   for(const join of positional){const other=array.name===join.name?array:await store.get(countKey(join.name,array.scope));if(!row||!other||row.length!==other.length)throw new AppError('DATASET_JOIN_LENGTH',[{acquisitions:row?.pointer??null,lookup:other?.pointer??null,expected:row?.length??null,actual:other?.length??null}]);}
  }
  if(!found.has('row')||!count)fail();
  yield {columns:fields.map(f=>f.name),sourceMapping:mapping};
  for(let i=0;i<count;i++){
   options.signal?.throwIfAborted();const row=await store.get('row:'+i),lookups=new Map();
   for(const j of joins){
    if(j.mode==='position'){const value=await store.get(positionKey(j.name,bindings(rowPattern,row.path),row.path[rowPattern.length]));if(!value)fail('DATASET_JOIN_LENGTH');lookups.set(j.name,value);continue;}
    const key=row.values['left:'+j.name]??missing(),value=['null','absent'].includes(key.kind)?null:await store.get(joinKey(j,row.path,key));
    if(!value&&j.unmatched==='error')fail('DATASET_JOIN_MISSING');lookups.set(j.name,value);
   }
   const values=[];
   for(const [index,f] of fields.entries())values.push(f.source==='row'?row.values['field:'+index]??missing():f.source==='context'?await store.get('context:'+pointer(f.parts.map((p,j)=>p==='*'?row.path[j]:p)))??missing():lookups.get(f.source)?.values['field:'+index]??missing());
   if(values.reduce((n,v)=>n+v.value.length,0)>limits.rowChars)fail();
   yield {cells:values.map(v=>v.value),valueKinds:values.map(v=>v.kind),cellPointers:values.map(v=>v.pointer),order:i+1,locator:{format:'json',pointer:pointer(row.path)}};
  }
 },options);
}
