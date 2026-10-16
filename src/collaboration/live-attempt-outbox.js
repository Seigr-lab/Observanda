import {exact,uuid} from '../modules/validation.js';
import {liveValid as valid} from './live-protocol.js';
import {LiveCommandOutbox} from './live-command-outbox.js';

// Separate records can save independently. One unresolved append per record
// must settle before another client tab can replace its pending request.
export class LiveAttemptOutbox extends LiveCommandOutbox{
 constructor(workspace,client){super(workspace,{
  file:key=>{valid(key&&uuid(key.connectionId)&&uuid(key.recordId));return '.observanda/collaboration/live/attempt-outbox/'+key.connectionId+'/'+key.recordId+'.json';},
  validate:(key,command)=>valid(command&&exact(command,['recordId','id','kind','item'])&&uuid(command.id)&&command.recordId===key.recordId&&['preparation','event','assessment'].includes(command.kind)&&command.item&&command.item.id===command.id),
  send:async(key,command)=>(await client(key.connectionId)).call('attempt-append',command),
  rejectedCodes:['INVALID','COLLABORATION_INVALID','RECORD_CHANGED','MATERIAL_MISSING','MATERIAL_INVALID','ATTEMPT_REFERENCE','ATTEMPT_IMMUTABLE']
 });}
}
