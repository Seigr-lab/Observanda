import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {csvCell,csvCellChunks} from './web/csv-cell.js';
import {exchangeLineFrames} from './dataset-exchange-lines.js';

// Both renditions read already retained, authenticated exchange bytes. Neither
// repeats a research query. Private staging may consume the stream before its
// final digest arrives. A failed rendition can never be handed to a caller.
export async function* exchangeDelimitedRendition(chunks,format,{signal}={}){
 if(!['csv','tsv'].includes(format))throw new AppError('INVALID');
 const separator=format==='csv'?',':'\t';
 const it=exchangeLineFrames(chunks,{signal})[Symbol.asyncIterator]();
 let current=await it.next(),inRows=false,first=true;
 try{
  while(!current.done){
   const frame=current.value;current=await it.next();
   if(frame.type==='column'){
    if(inRows)throw new AppError('MATERIAL_INVALID');
    if(!first)yield separator;
    yield csvCell(frame.column.name);first=false;
   }else if(frame.type==='row'){
    yield '\r\n';inRows=true;first=true;
   }else if(frame.type==='cell'){
    if(!inRows)throw new AppError('MATERIAL_INVALID');
    if(!first)yield separator;
    first=false;
    if(Object.hasOwn(frame,'text'))yield csvCell(frame.text);
    else{
     // Metadata attachments precede the retained text. Only the cell's
     // original lexical value belongs in the spreadsheet rendition.
     while(!current.done&&current.value.type==='sequence-item')current=await it.next();
     async function* spelling(){
      while(!current.done&&current.value.type==='text'){yield current.value.text;current=await it.next();}
     }
     yield* csvCellChunks(spelling());
    }
   }else if(frame.type==='complete')yield '\r\n';
  }
 }finally{await it.return?.();}
}

export async function* exchangeManifest(chunks,{format,typed,delimited,signal}){
 const hash=createHash('sha256');
 const line=value=>Buffer.from(JSON.stringify(value)+'\n');
 const emit=value=>{const bytes=line(value);hash.update(bytes);return bytes;};
 yield emit({type:'manifest',format:'observanda-dataset-manifest',version:1,encoding:'UTF-8',rowOrder:'source',columnIndices:'zero-based original schema',formulaPolicy:'retained scientific result values; spreadsheet formula execution disabled',spelling:'typed original; null, absent and empty string remain distinct',delimitedText:'all fields quoted; potentially active spreadsheet text prefixed with an apostrophe'});
 // The source is an immutable authenticated FileContent already completed by
 // the exporter. Only its metadata prefix is needed for the manifest.
 for await(const frame of exchangeLineFrames(chunks,{signal})){
  if(frame.type==='row'||frame.type==='complete')break;
  yield emit(frame);
 }
 yield emit({type:'members',files:[{name:'dataset.jsonl',bytes:typed.size,sha256:typed.sha256},{name:'dataset.'+format,bytes:delimited.size,sha256:delimited.sha256}]});
 signal?.throwIfAborted();yield line({type:'complete',sha256:hash.digest('hex')});
}
