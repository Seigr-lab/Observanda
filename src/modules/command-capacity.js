import {AppError} from '../errors.js';
import {serialize} from '../storage-format.js';
import {moduleEntityBytes,moduleCurrentBytes} from './catalogue.js';
import {MODULE_BYTES} from './capacity.js';
export async function admitModuleChanges(catalogue,head,workspaceId,entities,event){
 let {count,bytes}=await catalogue.currentSize(head);
 for(const entity of entities){
  const member=await catalogue.member(head,entity.id);
  if(member)bytes-=head.currentVersion===1?member.bytes:moduleEntityBytes(await catalogue.selected(head,entity.id));else count++;
  bytes+=moduleEntityBytes(entity);
 }
 if(moduleCurrentBytes(workspaceId,head.revision+1,{count,bytes})>MODULE_BYTES||Buffer.byteLength(serialize(event))>MODULE_BYTES)throw new AppError('LIMIT');
}
