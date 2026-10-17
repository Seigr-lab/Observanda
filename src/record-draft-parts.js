import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import parser from 'stream-json/parser.js';
import Assembler from 'stream-json/assembler.js';
import {draftRecordCollection,draftRecordField} from './record-draft-validation.js';
import {AppError} from './errors.js';

const invalid=()=>{throw new AppError('INVALID');};
const scalarNames=new Set(['stringValue','numberValue','trueValue','falseValue','nullValue']);
// The compact checkpoint envelope contains exactly one record. Expose its
// fields and collection items independently, including empty collections.
// Object keys are checked before assembly so duplicate/prototype keys cannot
// hide an invalid value behind a later property. No complete record or growing
// body collection is accumulated; domain values are validated one at a time.
export async function* recordDraftParts(chunks,{signal}={}){
 async function* decoded(){
  const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  for await(const bytes of chunks){signal?.throwIfAborted();yield decoder.decode(bytes,{stream:true});}
  const tail=decoder.decode();if(tail)yield tail;
 }
 const source=Readable.from(decoded()),tokens=parser.asStream({streamValues:true});let streamError;
 const completion=pipeline(source,tokens,{signal}).catch(error=>{streamError=error;});
 const stack=[];let capture=null,complete=false,scalarSize=0;
 const templatePath=path=>path.length>=3&&path[0]===0&&path[1]==='record'&&path[2]==='template'?path.slice(3).map(String):null;
 const templatePart=(path,type,value)=>({kind:'template',name:'template',path,type,...(type==='value'?{value}:{})});
 const templateContainer=(path,array)=>!path.length&&!array||path.length===1&&(path[0]==='fields'?array:path[0]==='values'&&!array)||path[0]==='fields'&&(path.length===2&&!array||path.length===3&&(path[2]==='choices'?array:path[2]==='numeric'&&!array));
 const templateScalar=path=>path.length===1&&['id','profileId','label','description'].includes(path[0])||path[0]==='values'&&path.length===2||path[0]==='fields'&&(path.length===3&&['key','label','type','unit','required'].includes(path[2])||path.length===4&&['choices','numeric'].includes(path[2]));
 const location=()=>{const parent=stack.at(-1);return parent?[...parent.path,parent.array?parent.count:parent.key]:[];};
 const finish=()=>{if(stack.at(-1)?.array)stack.at(-1).count++;};
 const part=path=>{
  if(path.length===2&&path[0]===0&&['baseRevision','expectedRevision'].includes(path[1]))return {kind:'change',name:path[1]};
  if(path[0]===0&&path[1]==='record'){
   if(path.length===3&&draftRecordField(path[2])&&!draftRecordCollection(path[2]))return {kind:'field',name:path[2]};
   if(path.length===4&&draftRecordCollection(path[2]))return {kind:'item',name:path[2],index:path[3]};
  }
  invalid();
 };
 try{
  for await(const token of tokens){
   signal?.throwIfAborted();const {name,value}=token;
   if(['startString','startKey','startNumber'].includes(name))scalarSize=0;
   if(['stringChunk','numberChunk'].includes(name)&&templatePath(location())!==null){scalarSize+=value.length;if(scalarSize>10000)invalid();}
   if(name==='keyValue'){
    const parent=stack.at(-1);if(!parent||parent.array||parent.keys?.has(value))invalid();
    parent.keys?.add(value);parent.key=value;
    const selected=templatePath(parent.path);if(selected){
     if(value.length>64)invalid();
     if(!selected.length&&!['id','profileId','label','description','fields','values'].includes(value))invalid();
     if(selected[0]==='fields'&&selected.length===2&&!['key','label','type','unit','required','choices','numeric'].includes(value))invalid();
     if(selected[0]==='fields'&&selected.length===3&&selected[2]==='numeric'&&!['version','representation','radix'].includes(value))invalid();
    }
    if(!capture){
     if(parent.path.length===1&&!['record','baseRevision','expectedRevision'].includes(value))invalid();
     if(parent.path.length===2&&!draftRecordField(value))invalid();
    }
    capture?.assembler.consume(token);continue;
   }
   if(name==='startObject'||name==='startArray'){
    const path=location(),array=name==='startArray',selected=templatePath(path);
    if(selected!==null){
     if(!templateContainer(selected,array))invalid();
     if(selected.at(-1)==='numeric'){capture={...templatePart(selected,'value'),assembler:new Assembler()};capture.assembler.consume(token);}
     else yield templatePart(selected,array?'array':'object');
    }else if(capture)capture.assembler.consume(token);
    else if(!path.length){if(!array||complete)invalid();}
    else if(path.length===1){if(path[0]!==0||array)invalid();}
    else if(path.length===2&&path[1]==='record'){if(array)invalid();}
    else if(path.length===3&&draftRecordCollection(path[2])){if(!array)invalid();yield {kind:'array',name:path[2]};}
    else{
     const descriptor=part(path);if(descriptor.kind==='change')invalid();
     capture={...descriptor,assembler:new Assembler()};capture.assembler.consume(token);
    }
    stack.push({path,array,count:0,key:null,keys:array||selected?.length===1&&selected[0]==='values'?null:new Set()});continue;
   }
   if(name==='endObject'||name==='endArray'){
    const parent=stack.pop();if(!parent)invalid();
    if(capture){
     capture.assembler.consume(token);
     if(capture.assembler.done){const {assembler,...descriptor}=capture;capture=null;yield {...descriptor,value:assembler.current};}
    }else if(templatePath(parent.path)!==null)yield templatePart(templatePath(parent.path),'end');
    else if(!parent.path.length){if(parent.count!==1)invalid();complete=true;}
    else if(parent.path.length===1){if(parent.keys.size!==3||!['record','baseRevision','expectedRevision'].every(key=>parent.keys.has(key)))invalid();}
    finish();continue;
   }
   if(scalarNames.has(name)){
    if(capture)capture.assembler.consume(token);
    else{const path=location(),selected=templatePath(path),assembler=new Assembler();assembler.consume(token);if(selected?.length){if(!templateScalar(selected))invalid();yield templatePart(selected,'value',assembler.current);}else{const descriptor=part(path);yield {...descriptor,value:assembler.current};}}
    finish();
   }
  }
  await completion;if(streamError)throw streamError;if(!complete||stack.length||capture)invalid();
 }catch(error){if(signal?.aborted)throw signal.reason;if(error instanceof AppError)throw error;throw new AppError('FORMAT');}
 finally{source.destroy();tokens.destroy();await completion;}
}
