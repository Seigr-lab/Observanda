import {AppError} from '../src/errors.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {prepareModuleCommand} from '../src/modules/prepare-command.js';
import {admitModuleChanges} from '../src/modules/command-capacity.js';

// Test-only: apply one module command to a single domain store that the caller
// holds open for writing, without the project command coordinator around it.
export async function executeModuleCommand(owner,store,research,command,fingerprint){
 const catalogue=new ModuleCatalogue(store),{book}=research,head=await catalogue.head(book.id),receipt=await catalogue.receipt(command.commandId,head.revision);
 const result=(entities,replayed,revision=head.revision)=>({modulePatch:{workspaceId:book.id,baseRevision:head.revision,revision,entities},changedIds:entities.map(e=>e.id),replayed});
 if(receipt){
  owner.validateEvent(receipt);if(receipt.fingerprint!==fingerprint)throw new AppError('MODULE_REPLAY');
  const entities=[];for(const e of receipt.changes){const current=await catalogue.selected(head,e.id);if(!current)throw new AppError('CATALOGUE_DAMAGED');owner.validateEntity(current);entities.push(current);}
  return result(entities,true);
 }
 const event=await prepareModuleCommand(owner,catalogue,head,research,command,fingerprint);
 admitModuleChanges(event.changes,event);
 await catalogue.writeChanges(head,event.changes,event);
 return result(event.changes,false,head.revision+1);
}
