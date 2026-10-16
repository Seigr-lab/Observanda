import {uuid} from '../modules/validation.js';
import {liveValid as valid} from './live-protocol.js';
import {LiveCommandOutbox} from './live-command-outbox.js';

// Preserve the existing on-disk contract: one creation per connection.
export class LiveCreationOutbox extends LiveCommandOutbox{
 constructor(workspace,client){super(workspace,{
  file:id=>{valid(uuid(id));return '.observanda/collaboration/live/creation-outbox/'+id+'.json';},
  validate:(id,command)=>valid(uuid(id)&&command&&uuid(command.id)),
  send:async(id,command)=>(await client(id)).call('create',command),
  rejectedCodes:['INVALID','RECORD_CHANGED']
 });}
}
