import {identityHash} from './identity.js';
import {liveValid as valid} from './live-protocol.js';
import {organizationTransaction} from './transaction.js';

// Domain owners supply the storage key, command validation and host operation.
// An acknowledgement stays encrypted locally until the UI confirms receipt.
export class LiveCommandOutbox{
 constructor(workspace,{file,validate,send,rejectedCodes}){this.workspace=workspace;this.file=file;this.validate=validate;this.sendRequest=send;this.rejectedCodes=rejectedCodes;this.sending=new Map();}
 async read(key){const raw=await this.workspace.readMetadata(this.file(key),1024*1024);if(!raw)return null;const value=JSON.parse(raw);this.validate(key,value.command);return value;}
 async acknowledge(key,id){
  return organizationTransaction(this.workspace,async()=>{const value=await this.read(key);if(!value)return {ok:true};valid(value.command.id===id&&(value.result||value.rejected),'CONFLICT');await this.workspace.removeMetadata(this.file(key));return {ok:true};});
 }
 async send(key,command){
  this.validate(key,command);valid(Buffer.byteLength(JSON.stringify(command))<=512*1024,'LIMIT');const file=this.file(key);
  const pending=await organizationTransaction(this.workspace,async()=>{
   const previous=await this.read(key);if(previous){valid(identityHash(previous.command)===identityHash(command),'CONFLICT');return previous;}
   const value={command};await this.workspace.writeMetadata(file,JSON.stringify(value));return value;
  });
  if(pending.result||pending.rejected)return pending;
  if(this.sending.has(file))return this.sending.get(file);
  const task=(async()=>{
   let next;
   try{next={command,result:await this.sendRequest(key,command)};}
   catch(error){
    // Access loss and transport/storage errors cannot establish that a
    // previously sent command did not commit. Keep those requests pending.
    if(!this.rejectedCodes.includes(error.code))throw error;
    next={command,rejected:{code:error.code,message:error.message}};
   }
   await organizationTransaction(this.workspace,async()=>{const current=await this.read(key);valid(current&&identityHash(current.command)===identityHash(command),'CONFLICT');await this.workspace.writeMetadata(file,JSON.stringify(next));});return next;
  })();
  this.sending.set(file,task);try{return await task;}finally{this.sending.delete(file);}
 }
}
