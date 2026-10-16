// Template commands share one adapter; the caller supplies the authenticated
// workspace or project owner, including the lifetime of package downloads.
import {RecordStarters} from './record-starters.js';
import {RecordStarterEditing} from './record-starter-editing.js';
import {RecordStarterCapture} from './record-starter-capture.js';
import {RecordStarterSource} from './record-starter-source.js';
import {RecordStarterTransfer} from './record-starter-transfer.js';
import {MediaStore} from './media.js';
import {withDatabaseRequest} from './database-request-context.js';
import {AppError} from './errors.js';

const commands=new Map();
const define=(names,Owner,{writes=[],cancellable=false,method=name=>name,options}={})=>{
 for(const name of names)commands.set('/api/research/starters/'+name,{starter:name,method:'POST',limit:2*1024*1024,write:writes.includes(name),cancellable,binary:name==='download',run:(storage,data,context)=>new Owner(storage,...(Owner===RecordStarters?[new MediaStore(storage)]:[]))[method(name)](data,options??context)});
};
define(['list','read','save','publish','release','history','archive','create','origin','export','preview','import'],RecordStarters,{writes:['save','publish','archive','create','import']});
define(['view','field','change'],RecordStarterEditing,{writes:['change']});
define(['capture-begin','capture-append','capture-finish'],RecordStarterCapture,{writes:['capture-begin','capture-append','capture-finish'],method:name=>name.slice(8)});
define(['publish-selected'],RecordStarters,{writes:['publish-selected'],method:()=> 'publish',options:{compact:true}});
define(['source','capture'],RecordStarterSource,{method:name=>name==='source'?'page':'prepare'});
define(['upload','uploadPart','packageView','packageField','accept','discard','download'],RecordStarterTransfer,{writes:['upload','uploadPart','accept','discard']});
define(['review'],RecordStarterTransfer,{writes:['review'],cancellable:true});
export const recordStarterRequest=(route,method='POST')=>method==='POST'?commands.get(route)??null:null;
export async function executeRecordStarterRequest(storage,request,data,{signal,binary}={}){
 const command=commands.get('/api/research/starters/'+request.starter);if(!command)throw new AppError('NOT_FOUND');
 const options={signal:command.write&&!command.cancellable?undefined:signal};
 return withDatabaseRequest(options.signal,async()=>{
  if(command.binary)return binary({stream:command.run(storage,data,options),mime:'application/vnd.observanda.template',download:'record.observanda-template'});
  return command.run(storage,data,options);
 });
}
