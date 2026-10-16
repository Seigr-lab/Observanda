// Synthetic source and independent expected values; never reads adopter repositories.
import {mkdir,writeFile,open} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export async function migrationFixture(root,{full=false,creative=false}={}){
 await mkdir(root,{recursive:true});
 const originals=new Map(),objects=[];
 async function file(name,parts){
  const target=path.join(root,name);await mkdir(path.dirname(target),{recursive:true});
  const out=await open(target,'wx'),sha=createHash('sha256');let bytes=0;
  try{for await(const part of parts){const b=Buffer.isBuffer(part)?part:Buffer.from(part);await out.writeFile(b);sha.update(b);bytes+=b.length;}}finally{await out.close();}
  const original={path:name,bytes,sha256:sha.digest('hex')};originals.set(name,original);return {...original,selector:{kind:'whole'}};
 }
 const json=(name,value)=>file(name,[JSON.stringify(value)+'\n']);
 function object(id,kind,files,extra={}){
  const o={id,revision:'r1',kind,title:id,disposition:'map',mapping:{kind},audience:'private',urls:[],dates:[{meaning:'occurrence',value:null}],files,links:[],...extra};objects.push(o);return o;
 }
 const relation=(type,id,revision='r1',required=true)=>({type,id,revision,required});
 if(creative){
  object('listening-method','method',[await json('procedure.json',{instructions:'Listen and note changes in the dawn chorus.'})]);
  object('morning-one','run',[await json('field/one.json',{notes:'Two distant calls.',conditions:'light rain'})],{links:[relation('followed','listening-method')],attributes:{outcome:'observed'},audience:'public',dates:[{meaning:'observation',value:'2026-04'}]});
  object('morning-two','run',[await json('field/two.json',{notes:'Recording interrupted; duration unknown.'})],{links:[relation('followed','listening-method')],attributes:{outcome:'incomplete'}});
  object('sound-original','artifact',[await file('audio/source.bin',[Buffer.from([0,255,45,0,8])])]);
 }else{
  const old=object('shared-method','method',[await json('methods/initial.json',{steps:['Prepare','Execute','Acquire'],parameter:{digits:'105',radix:6}})]);
  object('shared-method','method',[await json('methods/amended.json',{steps:['Prepare','Execute','Acquire','Review'],reason:'Added explicit review'})],{revision:'r2'});
  const investigations=[];
  for(let i=0;i<42;i++){
   const source=await json('investigations/'+i+'.json',{investigation:{title:'Investigation '+i,state:i===41?'active':'completed'},priorAttempts:i<23?[{id:'run-'+(i+42),notes:'Nested prior attempt with an explicitly declared identity.'}]:[]});
   investigations.push(source);
   object('investigation-'+i,'investigation',[{...source,selector:{kind:'json-pointer',value:'/investigation'}}],{attributes:{state:i===41?'active':'completed'}});
  }
  const first=JSON.stringify({id:'run-0',notes:'Complete acquisition; recognition unresolved.'})+'\n',second=JSON.stringify({id:'run-1',notes:'Interrupted attempt; partial return.'})+'\n';
  const chapter=await file('chapters/shared.jsonl',[first,second]);
  for(let i=0;i<70;i++){
   const source=i<2?{...chapter,selector:{kind:'bytes',offset:i?Buffer.byteLength(first):0,length:Buffer.byteLength(i?second:first)}}:i>=42&&i<65?{...investigations[i-42],selector:{kind:'json-pointer',value:'/priorAttempts/0'}}:await json('runs/'+i+'.json',{id:'run-'+i,notes:'Synthetic run'});
   object('run-'+i,'run',[source],{urls:['https://example.invalid/book/chapter#attempt-'+i],links:[relation('investigates','investigation-'+(i%42)),relation('followed',old.id,old.revision),relation('uses-source','artifact-2'),...(i>=42&&i<65?[relation('prior-attempt-of','run-'+(i-42))]:[])],attributes:{outcome:i===1?'incomplete':'observed',parameter:{digits:i===1?'110':'105',radix:6},unchangedMethod:true}});
  }
  async function* capture(){const chunk=Buffer.alloc(1024*1024,0xa5);for(let i=0;i<(full?96:1);i++)yield chunk;}
  async function* observations(){
   yield '{"observations":[';
   for(let i=0;i<4344;i++)yield (i?',':'')+JSON.stringify({rowId:'row-'+i,order:i,counter:'900719925474099312345',value:{digits:'105',radix:6},missing:i===4343?'not-acquired':null,diagnostic:full?'x'.repeat(4096):''});
   yield '],"declaredCount":4344}\n';
  }
  const prep=object('preparation-1','preparation',[await json('preparation.json',{meaning:'Preparation only, not proof of execution'})]);
  const returned=object('acquisition-1','record',[await json('acquisition.json',{meaning:'Returned evidence; not a preparation check'})],{links:[relation('acquired-for','run-0')]});
  async function* padding(bytes){const chunk=Buffer.alloc(Math.min(bytes,1024*1024),0x5a);while(bytes){const size=Math.min(bytes,chunk.length);yield chunk.subarray(0,size);bytes-=size;}}
  let returnedBytes=0;
  for(let i=0;i<273;i++){
   let source;
   if(i<246)source=await file('preparation/'+i+'.bin',padding(full?(i===245?23:1)*1024*1024:32));
   else if(i===246)source=await file('originals/capture.bin',capture());
   else if(i===247)source=await file('originals/analysis.json',observations());
   else source=await file('originals/'+i+'.bin',padding(full&&i===272?127*1024*1024-returnedBytes:32));
   object('artifact-'+i,'artifact',[source],{attributes:i===247?{observations:4344,representation:'opaque original JSON'}:{}});
   if(i===247)object('observations','dataset',[{...source,selector:{kind:'json-pointer',value:'/observations'}}],{links:[relation('derived-from','artifact-247')],attributes:{declaredRows:4344}});
   if(i<246)prep.links.push(relation('includes','artifact-'+i));
   else{returnedBytes+=source.bytes;returned.links.push(relation('includes','artifact-'+i));}
  }
  object('acquisition-assessment','assessment',[await json('assessments/acquisition.json',{criterion:'acquisition',outcome:'met',denominator:4344})],{links:[relation('assesses','run-0'),relation('evidence','artifact-247')],attributes:{outcome:'met'}});
  object('recognition-assessment','assessment',[await json('assessments/recognition.json',{criterion:'recognition',outcome:'unresolved',denominator:4344})],{links:[relation('assesses','run-0'),relation('evidence','artifact-1')],attributes:{outcome:'unresolved'}});
  object('historical-demonstration','record',[await json('private/history.json',{text:'Private demonstration; not a counted physical run.'})],{disposition:'exclude',reason:'Retained historical demonstration excluded from structured migration.',mapping:undefined});
 }
 const manifest={format:'observanda-source-inventory',version:1,adapter:{id:'declared-logbook',version:1},source:{namespace:creative?'synthetic:field':'synthetic:adoption',revision:'fixture-r1',title:creative?'Dawn listening studies':'Synthetic long-running study'},objects};
 const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(path.join(root,'inventory.observanda-source.json'),manifestBytes);
 originals.set('inventory.observanda-source.json',{path:'inventory.observanda-source.json',bytes:manifestBytes.length,sha256:createHash('sha256').update(manifestBytes).digest('hex')});
 return {manifest,originals,expected:creative?{objects:4,files:5,mapped:4,excluded:0,runs:2}:{objects:393,files:369,mapped:392,excluded:1,investigations:42,runs:70,nestedPriorRuns:23,preparationArtifacts:246,returnedArtifacts:27,preparationBytes:268*1024*1024,returnedBytes:127*1024*1024,observations:4344}};
}
