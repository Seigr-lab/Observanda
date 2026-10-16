// Bounded, lossless readers for retained evidence. Mapping is data, never code.
import {Readable} from 'node:stream';
import parser from 'stream-json/parser.js';
import {AppError} from './errors.js';
import {nestedMapping} from './web/dataset-preparation-model.js';
import {nestedDataset} from './dataset-nested.js';
export const DATASET_LIMITS=Object.freeze({chunkBytes:16384,rowChars:262144,columns:256,depth:64,keys:4096,pageRows:256,pageBytes:1048576});
const fail=()=>{throw new AppError('MATERIAL_TABLE');};
const pointer=value=>{
 if(typeof value!=='string'||value.length>2048||value!==''&&!value.startsWith('/')||/~(?![01])/u.test(value))fail();
 return value===''?[]:value.slice(1).split('/').map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'));
};
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const encodePointer=parts=>parts.length?'/'+parts.map(p=>String(p).replace(/~/g,'~0').replace(/\//g,'~1')).join('/'):'';
export function datasetMapping(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail();
 const format=input.format??'delimited';
 if(format==='json-nested'){try{return nestedMapping(input);}catch{fail();}}
 if(format==='delimited'){
  const delimiter=input.delimiter??'auto',header=input.header??true;
  if(!['auto',',','\t',';','|'].includes(delimiter)||typeof header!=='boolean')fail();
  return {format,delimiter,header};
 }
 if(!['json','jsonl'].includes(format)||!Array.isArray(input.fields)||!input.fields.length||input.fields.length>DATASET_LIMITS.columns)fail();
 const rowsPath=format==='json'?(input.rowsPath??''):'';
 pointer(rowsPath);
 const fields=input.fields.map(field=>{
  if(!field||typeof field.name!=='string'||!field.name.trim()||field.name.length>200)fail();
  pointer(field.path);return {name:field.name.trim(),path:field.path};
 });
 if(new Set(fields.map(f=>f.name)).size!==fields.length||new Set(fields.map(f=>f.path)).size!==fields.length)fail();
 return {format,rowsPath,fields};
}
async function* texts(source,{signal,progress=async()=>{},size=0,keepBOM=false}={}){
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:keepBOM});let done=0;
 for await(const bytes of source){
  for(let i=0;i<bytes.length;i+=DATASET_LIMITS.chunkBytes){
   signal?.throwIfAborted();const part=bytes.subarray(i,i+DATASET_LIMITS.chunkBytes);let text;
   try{text=decoder.decode(part,{stream:true});}catch{fail();}
   done+=part.length;yield text;
   await progress({stage:'reading dataset',done,total:size||done,unit:'bytes'});
  }
 }
 try{const tail=decoder.decode();if(tail)yield tail;}catch{fail();}
 signal?.throwIfAborted();
}
async function* csvRows(chunks,delimiter){
 let cells=[],value='',quoted=false,closed=false,quotePending=false,line=1,start=1,skipLF=false,quotedCR=false,rowChars=0,byteOffset=0,rowOffset=0;
 const cell=()=>{cells.push(value);if(cells.length>DATASET_LIMITS.columns)fail();value='';closed=false;};
 const row=()=>{cell();const result={cells,line:start,byteOffset:rowOffset,byteLength:byteOffset-rowOffset};cells=[];rowChars=0;rowOffset=byteOffset;return result;};
 for await(const chunk of chunks)for(const ch of chunk){
  const before=byteOffset;byteOffset+=Buffer.byteLength(ch);
  if(before===0&&ch==='\ufeff'){rowOffset=byteOffset;continue;}
  if(skipLF){skipLF=false;if(ch==='\n'){if(quotedCR)value+='\n';else rowOffset=byteOffset;quotedCR=false;continue;}quotedCR=false;}
  if(++rowChars>DATASET_LIMITS.rowChars)fail();
  if(quotePending){quotePending=false;if(ch==='"'){value+='"';continue;}quoted=false;closed=true;}
  if(quoted){
   if(ch==='"')quotePending=true;
   else {value+=ch;if(ch==='\n')line++;else if(ch==='\r'){line++;skipLF=true;quotedCR=true;}}
   continue;
  }
  if(ch===delimiter)cell();
  else if(ch==='\n'||ch==='\r'){
   const result=row();line++;start=line;skipLF=ch==='\r';
   if(result.cells.some(v=>v.trim()))yield result;
  }else if(ch==='"'&&!value&&!closed)quoted=true;
  else if(closed&&(ch===' '||ch==='\t'))continue;
  else if(closed||ch==='"')fail();
  else value+=ch;
 }
 if(quoted&&!quotePending)fail();
 if(value||cells.length||closed||quotePending){const result=row();if(result.cells.some(v=>v.trim()))yield result;}
}
async function* delimited(chunks,mapping){
 const iterator=chunks[Symbol.asyncIterator]();let delimiter=mapping.delimiter,first='';
 if(delimiter==='auto'){
  let quoted=false,ended=false;
  const counts=new Map([[',',0],['\t',0],[';',0],['|',0]]);
  while(!ended){
   const next=await iterator.next();if(next.done)break;first+=next.value;
   for(const ch of next.value){if(ch==='"')quoted=!quoted;else if(!quoted&&(ch==='\n'||ch==='\r')){ended=true;break;}else if(!quoted&&counts.has(ch))counts.set(ch,counts.get(ch)+1);}
   if(first.length>DATASET_LIMITS.rowChars+DATASET_LIMITS.chunkBytes)fail();
  }
  delimiter=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
 }
 async function* input(){try{if(first)yield first;while(true){const next=await iterator.next();if(next.done)break;yield next.value;}}finally{await iterator.return?.();}}
 let headings=null,count=0;
 for await(const row of csvRows(input(),delimiter)){
  if(!headings){
   headings=mapping.header?row.cells:row.cells.map((_,i)=>'Column '+(i+1));
   const used=new Set();
   headings=headings.map((heading,i)=>{const base=heading.trim()||'Column '+(i+1);let name=base,n=2;while(used.has(name))name=base+' ('+n+++')';used.add(name);return name;});
   if(headings.some(h=>h.length>200))fail();
   yield {columns:headings,sourceMapping:{...mapping,delimiter}};
   if(mapping.header)continue;
  }
  if(row.cells.length!==headings.length)fail();count++;
  yield {...row,locator:{format:'delimited',line:row.line,byteOffset:row.byteOffset,byteLength:row.byteLength},order:count};
 }
 if(!count)fail();
}
async function* jsonLines(chunks){
 // Frame JSONL as an array for the same token mapper. Validation here only
 // checks one JSON value per physical line; none of its converted values are used.
 let line='';
 yield '[';let count=0;
 const check=value=>{if(!value.trim())fail();try{JSON.parse(value);}catch{fail();}return value;};
 for await(const chunk of chunks){
  let start=0;
  for(let i=0;i<chunk.length;i++)if(chunk[i]==='\n'){
   line+=chunk.slice(start,i);if(line.length>DATASET_LIMITS.rowChars)fail();
   yield (count++?',':'')+check(line);line='';start=i+1;
  }
  line+=chunk.slice(start);if(line.length>DATASET_LIMITS.rowChars)fail();
 }
 if(line.length)yield (count++?',':'')+check(line);
 if(!count)fail();yield ']';
}
async function* mappedJSON(chunks,mapping,{signal}){
 const target=pointer(mapping.rowsPath),fields=mapping.fields.map(f=>pointer(f.path));
 async function* input(){for await(const text of mapping.format==='jsonl'?jsonLines(chunks):chunks)for(let i=0;i<text.length;i+=DATASET_LIMITS.chunkBytes)yield text.slice(i,i+DATASET_LIMITS.chunkBytes);}
 const stream=Readable.from(input()).compose(parser.asStream({packValues:false}),{signal});
 const stack=[];let key='',keyChars=0,scalar=null,row=null,targetFound=false,targetClosed=false,total=0;
 const nextPath=()=>{const p=stack.at(-1);return p?[...p.path,p.kind==='array'?String(p.index):p.key]:[];};
 const finishValue=()=>{const p=stack.at(-1);if(p?.kind==='array')p.index++;};
 const begin=path=>{
  if(targetFound&&!targetClosed&&path.length===target.length+1&&same(path.slice(0,-1),target)){
   if(row)fail();row={path,cells:Array(fields.length).fill(''),valueKinds:Array(fields.length).fill('absent'),chars:0};
  }
 };
 const capture=(path,kind,value)=>{
  if(!row)return;
  const relative=path.slice(row.path.length),index=fields.findIndex(f=>same(f,relative));
  if(index>=0){if(kind==='array'||kind==='object')fail();row.cells[index]=value;row.valueKinds[index]=kind;}
 };
 const finish=path=>{
  if(!row||!same(row.path,path))return null;
  const result={cells:row.cells,valueKinds:row.valueKinds,order:++total,
   locator:mapping.format==='jsonl'?{format:'jsonl',line:total}:{format:'json',pointer:encodePointer(path)}};
  row=null;return result;
 };
 yield {columns:mapping.fields.map(f=>f.name),sourceMapping:mapping};
 try{
  for await(const token of stream){
   signal?.throwIfAborted();const {name,value}=token;
   if(row&&(row.chars+=(typeof value==='string'?value.length:1))>DATASET_LIMITS.rowChars)fail();
   if(name==='startKey'){key='';continue;}
   if(name==='stringChunk'||name==='numberChunk'){
    if(scalar){if(scalar.keep){scalar.value+=value;if(scalar.value.length>DATASET_LIMITS.rowChars)fail();}}
    else {key+=value;if(key.length>2048)fail();}
    continue;
   }
   if(name==='endKey'){
    const p=stack.at(-1);if(p.keys.has(key)||p.keys.size===DATASET_LIMITS.keys||(keyChars+=key.length)>DATASET_LIMITS.rowChars)fail();p.keyChars+=key.length;p.keys.add(key);p.key=key;continue;
   }
   if(name==='startObject'||name==='startArray'){
    const path=nextPath(),kind=name==='startArray'?'array':'object';
    if(same(path,target)){if(kind!=='array'||targetFound)fail();targetFound=true;}
    begin(path);capture(path,kind,'');
    if(stack.length>=DATASET_LIMITS.depth)fail();
    stack.push({kind,path,index:0,key:null,keyChars:0,keys:new Set()});continue;
   }
   if(name==='endObject'||name==='endArray'){
    const p=stack.pop();keyChars-=p.keyChars;if(same(p.path,target))targetClosed=true;
    const result=finish(p.path);finishValue();if(result)yield result;continue;
   }
   if(name==='startString'||name==='startNumber'){
    const path=nextPath();begin(path);if(same(path,target))fail();
    scalar={path,kind:name==='startNumber'?'number':'string',value:'',keep:!!row&&fields.some(f=>same(f,path.slice(row.path.length)))};continue;
   }
   if(name==='endString'||name==='endNumber'){
    const {path,kind,value}=scalar;capture(path,kind,value);scalar=null;const result=finish(path);finishValue();if(result)yield result;continue;
   }
   if(['trueValue','falseValue','nullValue'].includes(name)){
    const path=nextPath();begin(path);if(same(path,target))fail();
    capture(path,value===null?'null':'boolean',value===null?'':String(value));const result=finish(path);finishValue();if(result)yield result;
   }
  }
  if(!targetFound||!targetClosed||!total)fail();
 }finally{stream.destroy();}
}
export async function* readDataset(source,input={},options={}){
 const mapping=datasetMapping(input),chunks=texts(source,{...options,keepBOM:mapping.format==='delimited'});
 try{yield* mapping.format==='delimited'?delimited(chunks,mapping):mapping.format==='json-nested'?nestedDataset(chunks,mapping,DATASET_LIMITS,options):mappedJSON(chunks,mapping,options);}
 catch(error){if(options.signal?.aborted)throw options.signal.reason;if(error instanceof AppError)throw error;fail();}
}
