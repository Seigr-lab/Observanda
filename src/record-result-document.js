// Result statements are individually admitted values. Reader windows and
// identity lookups retain the original collection and its immutable revision.
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {validResultStatement} from './web/result-statements.js';
import {RecordResultIndex} from './record-result-index.js';
import {collectionChanges} from './record-projection-dependency.js';
import {jsonFitsBytes} from './web/json-chunks.js';
const path=['results','statements'];
const invalid=()=>{throw new AppError('INVALID',[{field:'analysis results'}]);};
export const resultAnchorId=anchor=>typeof anchor==='string'?/^(?:record-)?result-([a-f0-9-]{36})$/.exec(anchor)?.[1]??null:null;
export async function resultDocumentHeader(document,{signal}={}){
 const root=await document.reference(['results'],{signal});if(root===null)return undefined;
 if((await document.tree.propertyNames(root)).sort().join()!=='statements,version'||(await document.field(['results','version'],{signal})).value!==1)invalid();
 await document.tree.arrayLength(root,['statements']);
 return {version:1,statements:[]};
}
export async function* resultDocumentStatements(document,{signal,fields}={}){
 if(!await document.reference(path,{signal}))return;
 for await(const item of document.items(path,{signal})){
  signal?.throwIfAborted();
  if(!fields){yield await document.tree.read(item.value);continue;}
  const value={};for(const name of fields){signal?.throwIfAborted();value[name]=(await document.tree.selected(item.value,[name])).value;}yield value;
 }
}
export async function validateResultDocument(document,{signal,draft=false,admitted=null}={}){
 const header=await resultDocumentHeader(document,{signal});if(!header)return undefined;
 const prior=admitted?await RecordResultIndex.open(admitted,{signal}):null,changes=prior?await collectionChanges(document,admitted,path,{signal}):null;
 if(changes?.unchanged)return header;
 return withScratch(async ids=>{
  if(changes){
   for await(const position of changes.positions()){
    signal?.throwIfAborted();if(position>=changes.total)continue;
    const item=(await document.field([...path,String(position)],{signal})).value;
    if(!validResultStatement(item,{draft})||!await ids.add(item.id))invalid();
    const previous=await prior.statement(item.id,{signal});
    // An identity may move only if its old position no longer retains it.
    // Changed peers are also checked against one another in scratch storage.
    if(previous&&previous.position!==position&&previous.position<changes.total&&(await document.field([...path,String(previous.position),'id'],{signal})).value===item.id)invalid();
   }
  }else for await(const item of resultDocumentStatements(document,{signal}))if(!validResultStatement(item,{draft})||!await ids.add(item.id))invalid();
  signal?.throwIfAborted();return header;
 },{signal});
}
export async function resultDocumentPosition(document,id,{signal}={}){
 const index=await RecordResultIndex.open(document,{signal});if(index)return (await index.statement(id,{signal}))?.position??-1;
 if(await document.reference(path,{signal}))for await(const item of document.items(path,{signal}))if((await document.tree.selected(item.value,['id'])).value===id)return item.index;
 return -1;
}
export async function resultFigureCount(document,figureId,{signal}={}){
 const index=await RecordResultIndex.open(document,{signal});if(index)return (await index.figureWindow(figureId,{limit:1,signal})).total;
 let count=0;
 if(await document.reference(path,{signal}))for await(const item of document.items(path,{signal})){
  signal?.throwIfAborted();if((await document.tree.selected(item.value,['kind'])).value==='figure'&&(await document.tree.selected(item.value,['figureId'])).value===figureId)count++;
 }
 return count;
}
export async function resultDocumentWindow(document,{offset=0,figureId=null,anchor,signal}={}){
 const header=await resultDocumentHeader(document,{signal});
 if(!header)return {results:undefined,page:{offset:0,total:0,count:0},figureId};
 const anchored=resultAnchorId(anchor),index=await RecordResultIndex.open(document,{signal});
 if(anchored){figureId=null;const position=await resultDocumentPosition(document,anchored,{signal});if(position>=0)offset=position;}
 let rows,total;
 if(index){const window=await (figureId?index.figureWindow(figureId,{offset,limit:4,signal}):index.window({offset,limit:4,signal}));({rows,total,offset}=window);}
 else{
  // Older originals have no derivative index. Scan identities without loading
  // statement bodies, retaining only the requested window and a bounded tail.
  total=0;rows=[];const tail=[];
  for await(const item of document.items(path,{signal})){
   signal?.throwIfAborted();
   if(figureId&&((await document.tree.selected(item.value,['kind'])).value!=='figure'||(await document.tree.selected(item.value,['figureId'])).value!==figureId))continue;
   const row={position:item.index};if(total>=offset&&rows.length<4)rows.push(row);tail.push(row);if(tail.length>4)tail.shift();total++;
  }
  if(offset>=total){offset=Math.max(0,total-1);rows=total?tail.slice(-1):[];}
 }
 const statements=[];for(const row of rows){signal?.throwIfAborted();statements.push((await document.field([...path,String(row.position)],{signal})).value);}
 return {results:{...header,statements},page:{offset,total,count:statements.length},figureId};
}
// Preserve the existing search spelling and small-string representation while
// feeding larger result text as bounded windows instead of concatenating it.
export async function resultDocumentSearchText(document,{signal}={}){
 const items=resultDocumentStatements(document,{signal,fields:['title','text','limitations']})[Symbol.asyncIterator]();let prefix='',first=true;
 try{
  while(true){
   const item=await items.next();if(item.done)return first?null:prefix;
   const part=[item.value.title,item.value.text,item.value.limitations].join(' ');prefix+=(first?'':' ')+part;first=false;
   if(!jsonFitsBytes(prefix.toLocaleLowerCase(),8191,{pretty:true}))return (async function*(){
    // Vocabulary batches depend on the lowered 2048-unit windows used by the
    // former single string. Statement boundaries must not change those hashes.
    let pending=prefix.toLocaleLowerCase();
    try{
     while(true){
      while(pending.length>=2048){signal?.throwIfAborted();yield pending.slice(0,2048);pending=pending.slice(2048);}
      signal?.throwIfAborted();const next=await items.next();
      if(next.done){if(pending)yield pending;return;}
      pending+=(' '+[next.value.title,next.value.text,next.value.limitations].join(' ')).toLocaleLowerCase();
     }
    }finally{await items.return?.();}
   })();
  }
 }catch(error){await items.return?.();throw error;}
}
