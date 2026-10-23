// Source rows are staged as encrypted, independently addressed cells. Neither a
// wide row nor a long selected value becomes one JavaScript object.
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {scratchIterator} from './scratch-iterator.js';
import {datasetMapping,datasetTexts,DATASET_LIMITS} from './dataset-reader.js';
import {datasetJSONTokens} from './dataset-json-tokens.js';
import {jsonPointerParts as parts,jsonPointer as pointer} from './web/dataset-preparation-model.js';
import {packedPosition} from './dataset-packed.js';
const fail=(code='MATERIAL_TABLE')=>{throw new AppError(code);};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const matches=(pattern,at)=>pattern.length===at.path.length&&pattern.every((p,i)=>p==='*'?at.arrays.includes(i):p===at.path[i]);
const missing=()=>({kind:'absent',value:'',pointer:null,length:0});
const CHARS=16384;
function textWriter(work,key,kind,location){
 let buffer='',length=0,count=0;const hash=createHash('sha256');
 const flush=async()=>{if(buffer){await work.put(key+':'+count++,buffer);buffer='';}};
 return {async add(value){hash.update(Buffer.from(value,'utf16le'));length+=value.length;if(!Number.isSafeInteger(length))fail('MATERIAL_DATASET_LIMIT');
   for(let from=0;from<value.length;){const n=Math.min(CHARS-buffer.length,value.length-from);buffer+=value.slice(from,from+n);from+=n;if(buffer.length===CHARS)await flush();}},
  async finish(){const digest=hash.digest('hex');if(!count)return {kind,value:buffer,length,digest,pointer:location};await flush();return {kind,length,digest,pointer:location,chunks:count,key};}};
}
async function* valueChunks(work,value){if(Object.hasOwn(value,'value'))yield value.value;else for(let i=0;i<value.chunks;i++){const text=await work.get(value.key+':'+i);if(typeof text!=='string')fail();yield text;}}
const exposed=(work,value)=>({...value,read:()=>valueChunks(work,value)});
export async function* readPagedDataset(source,input={},options={}){
 const mapping=datasetMapping(input);
 yield* scratchIterator(work=>mapping.format==='delimited'?csv(work,datasetTexts(source,{...options,keepBOM:true}),mapping,options):json(work,datasetTexts(source,options),mapping,options),options);
}
async function* csv(work,chunks,mapping,{signal}={}){
 const iterator=chunks[Symbol.asyncIterator]();let delimiter=mapping.delimiter,prefixCount=0;
 try{if(delimiter==='auto'){
  // Retain the inspected prefix in encrypted scratch: even a multi-megabyte
  // quoted first field cannot conceal the actual separator or fill the heap.
  let quoted=false,ended=false;const counts=new Map([[',',0],['\t',0],[';',0],['|',0]]);
  while(!ended){signal?.throwIfAborted();const next=await iterator.next();if(next.done)break;await work.put('csv-prefix:'+prefixCount++,next.value);for(const ch of next.value){if(ch==='"')quoted=!quoted;else if(!quoted&&(ch==='\r'||ch==='\n')){ended=true;break;}else if(!quoted&&counts.has(ch))counts.set(ch,counts.get(ch)+1);}}
  delimiter=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
 }}catch(error){await iterator.return?.();throw error;}
 async function* input(){try{for(let i=0;i<prefixCount;i++)yield await work.get('csv-prefix:'+i);for(;;){const n=await iterator.next();if(n.done)return;yield n.value;}}finally{await iterator.return?.();}}
 let row=0,column=0,width=null,line=1,start=1,byte=0,rowByte=0,quoted=false,closed=false,pending=false,skipLF=false,quotedCR=false,nonblank=false,touched=false,cellStarted=false;
 let writer=textWriter(work,'csv:0:0','string',null),buffer='';
 const append=async value=>{cellStarted=true;buffer+=value;if(value.trim())nonblank=true;if(buffer.length>=CHARS){await writer.add(buffer);buffer='';}};
 const cell=async()=>{await writer.add(buffer);buffer='';const value=await writer.finish();await work.put('csv-cell:'+column,value);column++;writer=textWriter(work,'csv:'+row+':'+column,'string',null);closed=false;cellStarted=false;};
 const finish=async()=>{await cell();const result={columns:column,line:start,byteOffset:rowByte,byteLength:byte-rowByte,nonblank};column=0;row++;writer=textWriter(work,'csv:'+row+':0','string',null);rowByte=byte;nonblank=false;touched=false;return result;};
 async function* output(info){
  if(!info.nonblank)return;
  if(width===null){width=info.columns;
   for(let index=0;index<width;index++){
    const original=await work.get('csv-cell:'+index);if(mapping.header&&(!Object.hasOwn(original,'value')||original.value.length>200))fail();
    const base=mapping.header?original.value.trim()||'Column '+(index+1):'Column '+(index+1);let name=base,n=2;while(!await work.add('heading:'+name))name=base+' ('+n+++')';
    await work.put('column:'+index,{name});
   }
   yield {columnCount:width,sourceMapping:{...mapping,delimiter},columns:async function*(){for(let i=0;i<width;i++)yield await work.get('column:'+i);}};
   if(mapping.header)return;
  }
  if(info.columns!==width)fail();
  yield {line:info.line,locator:{format:'delimited',line:info.line,byteOffset:info.byteOffset,byteLength:info.byteLength},cells:async function*(){for(let i=0;i<width;i++)yield exposed(work,await work.get('csv-cell:'+i));}};
 }
 let rows=0;
 for await(const chunk of input())for(const ch of chunk){
  signal?.throwIfAborted();const before=byte;byte+=Buffer.byteLength(ch);if(before===0&&ch==='\ufeff'){rowByte=byte;continue;}
  if(skipLF){skipLF=false;if(ch==='\n'){if(quotedCR)await append('\n');else rowByte=byte;quotedCR=false;continue;}quotedCR=false;}
  touched=true;
  if(pending){pending=false;if(ch==='"'){await append('"');continue;}quoted=false;closed=true;}
  if(quoted){if(ch==='"')pending=true;else{await append(ch);if(ch==='\n')line++;else if(ch==='\r'){line++;skipLF=true;quotedCR=true;}}continue;}
  if(ch===delimiter)await cell();
  else if(ch==='\n'||ch==='\r'){const info=await finish();line++;start=line;skipLF=ch==='\r';for await(const item of output(info)){if(item.cells)item.order=++rows;yield item;}}
  else if(ch==='"'&&!cellStarted&&closed===false){quoted=true;}
  else if(closed&&(ch===' '||ch==='\t'))continue;
  else if(closed||ch==='"')fail();else await append(ch);
 }
 if(quoted&&!pending)fail();
 if(touched||column||closed||pending){for await(const item of output(await finish())){if(item.cells)item.order=++rows;yield item;}}
 if(!rows)fail();
}
async function* framedLines(chunks){
 let pending=false,seen=false,content=false;
 yield '[';
 for await(const chunk of chunks){let start=0;for(let i=0;i<chunk.length;i++)if(chunk[i]==='\n'){
   const part=chunk.slice(start,i);if(pending){if(!part.trim())fail();yield ',';pending=false;}if(part){yield part;content||=!!part.trim();}
   if(!content)fail();yield '\n';pending=true;seen=true;content=false;start=i+1;
  }const tail=chunk.slice(start);if(tail){if(pending){yield ',';pending=false;}yield tail;content||=!!tail.trim();}}
 if(!seen&&!content)fail();yield ']';
}
async function* json(work,chunks,mapping,{signal}={}){
 const nested=mapping.format==='json-nested',rowPattern=parts(mapping.rowsPath??''),joins=nested?mapping.joins:[],fields=Array.isArray(mapping.fields)?mapping.fields:[],discover=mapping.fields==='all';let fieldCount=0;
 const definitions=[{name:'row',pattern:rowPattern},...joins.map(j=>({...j,pattern:parts(j.rowsPath)}))],byName=new Map(definitions.map(d=>[d.name,d]));
 // Request descriptors are bounded by the HTTP command budget. The retained
 // schema and lookup state are paged independently from this command envelope.
 const addField=async f=>{const index=fieldCount++;if(!Number.isSafeInteger(fieldCount))fail('MATERIAL_DATASET_LIMIT');
  const source=f.source??'row',key='field:'+source+':'+f.path,prior=await work.get(key);
  await work.put('field-next:'+index,prior??null);await work.put(key,index);await work.put('column:'+index,{name:f.name,sourceField:f});
 };
 for(const field of fields)await addField(field);
 const match=(d,at,direct=false)=>direct?at.path.length===d.pattern.length+1&&at.arrays.includes(d.pattern.length)&&(nested?matches(d.pattern,{path:at.path.slice(0,-1),arrays:at.arrays}):same(d.pattern,at.path.slice(0,-1))):nested?matches(d.pattern,at):same(d.pattern,at.path);
 const active=new Map(),arrays=new Map(),found=new Set(),captures=new Map();let count=0,arrayCount=0,valueId=0;
 const scope=(pattern,path)=>pattern.flatMap((p,i)=>p==='*'?[path[i]]:[]);
 const countKey=(name,s)=>JSON.stringify(['length',name,s]);
 const posKey=(name,s,index)=>JSON.stringify(['position',name,s,index]);
 const rowKey=r=>'value:'+r.name+':'+pointer(r.path);
 const joinKey=(d,path,key)=>JSON.stringify(['join',d.name,scope(d.pattern,path),key.kind,key.digest,key.length]);
 const lookupFields=async(source,path)=>{let current=await work.get('field:'+source+':'+pointer(path));return current===undefined?null:current;};
 const contextPath=at=>at.path.map((p,i)=>rowPattern[i]==='*'&&at.arrays.includes(i)?'*':p);
 const targets=async at=>{
  const result=[];
  for(const d of definitions){const row=active.get(d.name);if(!row)continue;const packed=d.packed?packedPosition(d,at):null,relative=d.packed?packed?.relative:at.path.slice(row.path.length);if(!relative)continue;
   const field=await lookupFields(d.name,relative);if(field!==null)result.push({kind:'fields',row,field});
   if(d.name==='row')for(const j of joins)if(j.mode!=='position'&&same(relative,parts(j.leftPath)))result.push({kind:'key',row,slot:'left:'+j.name});
   if(d.name!=='row'&&d.mode!=='position'&&same(relative,parts(d.rightPath)))result.push({kind:'key',row,slot:'key'});
  }
  const context=await lookupFields('context',contextPath(at));if(context!==null)result.push({kind:'context',field:context,path:at.path});
  return result;
 };
 const save=async(c,value)=>{for(const target of c.targets){if(target.kind==='key'){if(['array','object'].includes(value.kind))fail('DATASET_JOIN_KEY');await work.put(rowKey(target.row)+':'+target.slot,value);}
   else if(target.kind==='context')await work.put('context:'+pointer(target.path),value);
   else{let index=target.field;while(index!==null){await work.put(rowKey(target.row)+':field:'+index,value);index=await work.get('field-next:'+index);}}
  }};
 const finish=async d=>{
  const row=active.get(d.name);if(!row)return;active.delete(d.name);if(arrays.has(d.name))arrays.get(d.name).length++;
  if(d.name==='row')await work.put('row:'+count++,row);
  else if(d.mode==='position')await work.put(posKey(d.name,scope(d.pattern,row.path),String(row.position??row.path[d.pattern.length])),row);
  else{const key=await work.get(rowKey(row)+':key')??missing();if(['absent','null'].includes(key.kind))fail('DATASET_JOIN_KEY');if(!await work.add(joinKey(d,row.path,key),row))fail('DATASET_JOIN_DUPLICATE');}
 };
 const prefix=async(c,t)=>{const parent=c.stack.at(-1);if(!parent)return;if(parent.used)await c.writer.add(',');parent.used=true;if(parent.type==='object')await c.writer.add(JSON.stringify(t.path.at(-1))+':');};
 for await(const token of datasetJSONTokens(mapping.format==='jsonl'?framedLines(chunks):chunks,async at=>captures.size>0||(await targets(at)).length>0,DATASET_LIMITS,{signal,chunked:true,work})){
  const start=token.event==='begin'||token.event==='scalar-start'||token.event==='value'&&!token.chunked;
  for(const d of definitions){
   if(match(d,token)){
    if(token.event==='begin'){if(token.type!=='array')fail();found.add(d.name);arrays.set(d.name,{name:d.name,scope:scope(d.pattern,token.path),pointer:pointer(token.path),length:0,sourceLength:0});}
    else if(token.event==='end'){const a=arrays.get(d.name);if(!a)fail();arrays.delete(d.name);if(d.packed&&(a.sourceLength<d.packed.offset+d.packed.width*d.packed.count||a.length!==d.packed.count))fail('DATASET_PACKED_LENGTH');await work.put(countKey(d.name,a.scope),a);await work.put('alignment:'+arrayCount++,a);}
    else if(start)fail();
   }
   const direct=match(d,token,true),packing=d.packed?packedPosition(d,token):null;
   if(start&&(d.packed?direct&&packing?.slot===0:direct)){if(active.has(d.name))fail();active.set(d.name,{name:d.name,path:token.path,...(packing?{position:packing.record}:{})});}
  }
  if(start&&discover){const row=active.get('row');if(row){const relative=token.path.slice(row.path.length);if(relative.length===1||relative.length===0&&token.event!=='begin'){
   const path=pointer(relative);if(await lookupFields('row',relative)===null){const base=(relative.at(-1)??'Value').slice(0,180)||'Value';let name=base,n=2;while(!await work.add('json-heading:'+name))name=base+' ('+n+++')';await addField({name,path,source:'row'});}
  }}}
  if(start){const chosen=await targets(token);if(chosen.length){const location=pointer(token.path),kind=token.type??token.kind;if(location.length>2048)fail();captures.set(location,{targets:chosen,kind,path:token.path,stack:[],writer:textWriter(work,'text:'+valueId++,kind,location)});}}
  for(const [key,c] of captures){
   if(token.path.length<c.path.length||!same(token.path.slice(0,c.path.length),c.path))continue;
   if(token.event==='begin'){await prefix(c,token);await c.writer.add(token.type==='array'?'[':'{');c.stack.push({type:token.type,used:false});}
   else if(token.event==='scalar-start'){await prefix(c,token);if(c.stack.length&&token.kind==='string')await c.writer.add('"');}
   else if(token.event==='scalar-chunk')await c.writer.add(c.stack.length&&token.kind==='string'?JSON.stringify(token.value).slice(1,-1):token.value);
   else if(token.event==='value'){
    if(token.chunked){if(c.stack.length&&token.kind==='string')await c.writer.add('"');}
    else{await prefix(c,token);await c.writer.add(token.kind==='null'?c.stack.length?'null':'':token.value);}
   }else if(token.event==='end'){const prior=c.stack.pop();if(!prior)fail();await c.writer.add(prior.type==='array'?']':'}');}
   if((token.event==='end'||token.event==='value')&&same(token.path,c.path)){await save(c,await c.writer.finish());captures.delete(key);}
  }
  for(const d of definitions){const direct=match(d,token,true),packing=d.packed?packedPosition(d,token):null;
   if(d.packed&&direct&&(token.event==='end'||token.event==='value')){const a=arrays.get(d.name);if(!a)fail();a.sourceLength++;}
   if((token.event==='end'||token.event==='value')&&(d.packed?direct&&packing?.slot===d.packed.width-1:direct))await finish(d);
  }
 }
 if(captures.size||active.size||!found.has('row')||!count)fail();
 for(let i=0;i<arrayCount;i++){const a=await work.get('alignment:'+i),r=a.name==='row'?a:await work.get(countKey('row',a.scope));for(const j of joins.filter(j=>j.mode==='position')){const b=a.name===j.name?a:await work.get(countKey(j.name,a.scope));if(!r||!b||r.length!==b.length)throw new AppError('DATASET_JOIN_LENGTH',[{acquisitions:r?.pointer??null,lookup:b?.pointer??null,expected:r?.length??null,actual:b?.length??null}]);}}
 yield {columnCount:fieldCount,sourceMapping:mapping,columns:async function*(){for(let i=0;i<fieldCount;i++)yield await work.get('column:'+i);}};
 for(let order=0;order<count;order++){
  signal?.throwIfAborted();const row=await work.get('row:'+order),lookup=new Map();
  for(const j of joins){const d=byName.get(j.name);let value;
   if(j.mode==='position'){value=await work.get(posKey(j.name,scope(rowPattern,row.path),String(row.path[rowPattern.length])));if(!value)fail('DATASET_JOIN_LENGTH');}
   else{const key=await work.get(rowKey(row)+':left:'+j.name)??missing();value=['null','absent'].includes(key.kind)?null:await work.get(joinKey(d,row.path,key));if(!value&&j.unmatched==='error')fail('DATASET_JOIN_MISSING');}lookup.set(j.name,value);
  }
  yield {order:order+1,locator:mapping.format==='jsonl'?{format:'jsonl',line:order+1}:{format:'json',pointer:pointer(row.path)},cells:async function*(){for(let index=0;index<fieldCount;index++){const f=(await work.get('column:'+index)).sourceField,source=f.source??'row';let value;
   if(source==='context')value=await work.get('context:'+pointer(parts(f.path).map((p,i)=>p==='*'?row.path[i]:p)));
   else{const owner=source==='row'?row:lookup.get(source);if(owner)value=await work.get(rowKey(owner)+':field:'+index);}yield exposed(work,value??missing());
  }}};
 }
}
