import {networkInterfaces} from 'node:os';
import {startLiveHost} from './live-host.js';
import {LiveClient} from './live-client.js';
import {liveCard,liveValid as valid,liveEndpoint} from './live-protocol.js';
import {identityHash} from './identity.js';
import {uuid} from '../modules/validation.js';
import {randomUUID} from 'node:crypto';
import {LiveDrafts} from './live-drafts.js';
import {LiveCreationOutbox} from './live-creation-outbox.js';
import {LiveAttemptOutbox} from './live-attempt-outbox.js';

const prefix='.observanda/collaboration/live/connections/';
export class LiveConnections{
 constructor(workspace,device){this.workspace=workspace;this.device=device;this.drafts=new LiveDrafts(workspace);this.creations=new LiveCreationOutbox(workspace,id=>this.client(id));this.attempts=new LiveAttemptOutbox(workspace,id=>this.client(id));this.host=null;this.clients=new Map();this.connecting=new Set();this.pending=new Set();this.closed=false;this.starting=null;this.closing=null;}
 close(){
  if(this.closing)return this.closing;this.closed=true;
  for(const client of [...this.clients.values(),...this.connecting])client.close();
  // Finish local reads/transactions before the workspace owner clears its vault.
  this.closing=(async()=>{await this.starting?.catch(()=>{});await this.host?.close();this.host=null;await Promise.allSettled([...this.pending]);this.clients.clear();})();return this.closing;
 }
 async client(id){valid(uuid(id));valid(!this.closed,'ACCESS_LOCKED');if(!this.clients.has(id)){const raw=await this.workspace.readMetadata(prefix+id+'.json',32768);valid(!this.closed,'ACCESS_LOCKED');valid(raw,'NOT_FOUND');const saved=JSON.parse(raw);valid(saved.active!==false,'NOT_FOUND');if(!this.clients.has(id))this.clients.set(id,new LiveClient(this.device,saved.card));}return this.clients.get(id);}
 async state(){
  const connections=[];for await(const name of this.workspace.metadataNames(prefix.slice(0,-1))){if(!name.endsWith('.json')||!uuid(name.slice(0,-5)))continue;const raw=await this.workspace.readMetadata(prefix+name,32768),saved=JSON.parse(raw);if(saved.active===false)continue;const card=liveCard(saved.card,{allowExpired:true});connections.push({id:name.slice(0,-5),title:card.title,endpoint:card.endpoint});}
  return {hosting:this.host?{endpoint:this.host.endpoint}:null,addresses:Object.values(networkInterfaces()).flat().filter(v=>!v.internal&&v.family==='IPv4').map(v=>v.address),connections};
 }
 async command(operation,data){
  valid(!this.closed,'ACCESS_LOCKED');
  const task=this.run(operation,data);this.pending.add(task);try{return await task;}finally{this.pending.delete(task);}
 }
 async run(operation,data){
  if(operation==='state')return this.state();
  if(operation==='draft')return this.drafts.command(data);
  if(operation==='drafts')return this.drafts.list(data);
  if(operation==='creation-pending')return {pending:await this.creations.read(data.connectionId)};
  if(operation==='create-record')return this.creations.send(data.connectionId,data.command);
  if(operation==='creation-acknowledge')return this.creations.acknowledge(data.connectionId,data.id);
  if(operation==='attempt-pending')return {pending:await this.attempts.read(data)};
  if(operation==='append-attempt')return this.attempts.send({connectionId:data.connectionId,recordId:data.command?.recordId},data.command);
  if(operation==='attempt-acknowledge')return this.attempts.acknowledge(data,data.id);
  if(operation==='start'){
   valid(!this.host&&!this.starting,'CONFLICT');liveEndpoint(data.endpoint);
   this.starting=startLiveHost(this.workspace,this.device,{host:data.host??'0.0.0.0',port:data.port??0,advertise:data.endpoint});
   try{this.host=await this.starting;}finally{this.starting=null;}return this.state();
  }
  if(operation==='stop'){await this.starting?.catch(()=>{});await this.host?.close();this.host=null;return this.state();}
  if(operation==='card'){valid(this.host,'LIVE_UNAVAILABLE');return {card:await this.host.card(data.grantId)};}
  if(operation==='connect'){
   const card=liveCard(data.card);valid(data.verifiedFingerprint===data.card.identity.id,'COLLABORATION_VERIFY');
   const client=new LiveClient(this.device,data.card);this.connecting.add(client);
   try{await client.call('list');valid(!this.closed,'ACCESS_LOCKED');return await this.workspace.withLock(async()=>{
    valid(!this.closed,'ACCESS_LOCKED');
    // The verified owner and grant identify the connection. Renewed TLS
    // certificates or a changed address must not strand its local drafts.
    const identity=value=>identityHash([value.identity.id,value.value.workspaceId,value.value.organizationId,value.value.grantId]);
    for await(const name of this.workspace.metadataNames(prefix.slice(0,-1))){const raw=await this.workspace.readMetadata(prefix+name,32768),old=JSON.parse(raw);if(identity(old.card)===identity(data.card)){const id=name.slice(0,-5);await this.workspace.writeMetadata(prefix+name,JSON.stringify({card:data.card,active:true}));this.clients.get(id)?.close();this.clients.set(id,client);return {id};}}
    const id=randomUUID();await this.workspace.writeMetadata(prefix+id+'.json',JSON.stringify({card:data.card}));this.clients.set(id,client);return {id};
   });}catch(error){client.close();throw error;}finally{this.connecting.delete(client);if(this.closed)client.close();}
  }
  if(operation==='disconnect'){
   valid(uuid(data.connectionId));await this.workspace.withLock(async()=>{const file=prefix+data.connectionId+'.json',raw=await this.workspace.readMetadata(file,32768);valid(raw,'NOT_FOUND');await this.workspace.writeMetadata(file,JSON.stringify({...JSON.parse(raw),active:false}));});this.clients.get(data.connectionId)?.close();this.clients.delete(data.connectionId);return {ok:true};
  }
  if(operation==='request'){valid(!['file'].includes(data.operation));return (await this.client(data.connectionId)).call(data.operation,data.data);}
  valid(false);
 }
}
