// Admit exactly one retained reader beside its current writer for handover
// comparison. Ordinary readers never acquire write authority from this scope.
import {AsyncLocalStorage} from 'node:async_hooks';
import {catalogueContext} from './research-catalogue.js';
import {AppError} from './errors.js';
const pairs=new AsyncLocalStorage(),reading=new AsyncLocalStorage();
export async function withCatalogueInspection(before,after,operation){
 const held=catalogueContext.getStore(),workspace=after.workspace;
 if(held?.root!==workspace.root||held.vault!==workspace.vault||held.db!==after.db||before.db===after.db||before.workspace.root!==workspace.root||before.workspace.vault!==workspace.vault)throw new AppError('INVALID');
 const isolation=(await before.db.get('SHOW transaction_isolation')).transaction_isolation,readOnly=(await before.db.get('SHOW transaction_read_only')).transaction_read_only;
 if(!['repeatable read','serializable'].includes(isolation)||readOnly!=='on')throw new AppError('INVALID');
 return pairs.run({root:workspace.root,vault:workspace.vault,reader:before.db,writer:after.db},operation);
}
export function inspectRecordedCatalogue(workspace,store,operation){
 const pair=pairs.getStore(),held=catalogueContext.getStore();
 if(!pair||pair.root!==workspace.root||pair.vault!==workspace.vault||pair.reader!==store.db||pair.writer!==held?.db)throw new AppError('LOCKED');
 return catalogueContext.run(null,()=>reading.run({root:workspace.root,vault:workspace.vault},operation));
}
export function assertCatalogueWritable(workspace){
 const inspected=reading.getStore();if(inspected?.root===workspace.root&&inspected.vault===workspace.vault)throw new AppError('INVALID');
}
