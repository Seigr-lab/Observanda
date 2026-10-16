import {moduleReceiptMatches} from '../project-module-receipts.js';
import {AppError} from '../errors.js';
import {ModuleCatalogue} from './catalogue.js';
import {prepareModuleCommand} from './prepare-command.js';
import {admitModuleChanges} from './command-capacity.js';

// Called under the existing workspace writer transaction. Constraint metadata
// and selected originals share that same snapshot and commit atomically.
export async function executeModuleCommand(owner,store,research,command,fingerprint,{compact=false}={}){
 const catalogue=new ModuleCatalogue(store),{book}=research,head=await catalogue.head(book.id),receipt=await catalogue.receipt(command.commandId,head.revision);
 async function result(entities,replayed,revision=head.revision){
  const changedIds=entities.map(e=>e.id);
  if(compact)return {modulePatch:{workspaceId:book.id,baseRevision:head.revision,revision,entities},changedIds,replayed};
  return {data:await catalogue.read(book.id,{history:false}),changedIds,replayed};
 }
 if(receipt){
  owner.validateEvent(receipt);if(!await moduleReceiptMatches(store,command,receipt,fingerprint))throw new AppError('MODULE_REPLAY');
  // Retry acknowledges the earlier command but returns current versions, so a
  // later independent edit is never replaced with the receipt's old body.
  const entities=[];for(const e of receipt.changes){const current=await catalogue.selected(head,e.id);if(!current)throw new AppError('CATALOGUE_DAMAGED');owner.validateEntity(current);entities.push(current);}
  return result(entities,true);
 }
 const event=await prepareModuleCommand(owner,catalogue,head,research,command,fingerprint);
 await admitModuleChanges(catalogue,head,book.id,event.changes,event);
 await catalogue.writeChanges(head,event.changes,event);
 return result(event.changes,false,head.revision+1);
}
