// A committed project move can outlive the response that updates a client's
// grant. Authenticate that handoff before an ordinary read retires the grant.
import {assertWorkspaceProjectMoveOwner} from './workspace-project-move-owner.js';
import {ProjectMoves} from './project-move.js';
import {ProjectStorage} from './project-storage.js';
import {projectTransferReceipt} from './project-transfer.js';
import {catalogueBinding} from './postgres-activation.js';
import {assertProjectMoveDirectory} from './project-move-boundaries.js';
import {authenticateKeyring} from './security/keyring.js';
import {AppError} from './errors.js';
export async function projectGrantRelocation(registry,entry,access,saved){
 if(!saved?.vault?.key||saved.locked||saved.expires<=Date.now()||saved.root===entry.root)return false;
 const value=await new ProjectMoves(registry).read(entry.projectId);
 if(!value||value.source!==saved.root||value.destination!==entry.root)return false;
 if(!['verified','adopted','retired','releasing','complete'].includes(value.phase)||value.projectId!==entry.projectId||value.namespaceId!==entry.namespaceId||value.vaultId!==entry.vaultId||saved.vault.id!==entry.vaultId||access.etag!==saved.etag)throw new AppError('STORAGE_MOVE_STATE');
 if(value.version===3&&value.workspaceMoveId)await assertWorkspaceProjectMoveOwner(registry,value);
 authenticateKeyring(access.value,saved.vault);
 const storage=new ProjectStorage(entry.root,entry.projectId,saved.vault),receipt=await projectTransferReceipt(storage),binding=await catalogueBinding(entry.root);
 if(receipt?.phase!=='verified'||receipt.id!==value.id||receipt.source!==value.source||receipt.sourceId!==value.sourceId||receipt.projectId!==entry.projectId||receipt.namespaceId!==entry.namespaceId||receipt.vaultId!==entry.vaultId||binding?.id!==value.destinationId||binding.placement!=='project'||binding.projectId!==entry.projectId)throw new AppError('STORAGE_MOVE_STATE');
 if((await storage.catalogue(async store=>(await store.snapshot()).metadata)).id!==entry.namespaceId)throw new AppError('DATABASE_LOCATION');
 if(value.destinationDirectory)await assertProjectMoveDirectory(entry.root,value.destinationDirectory);
 const latest=await registry.locate(entry.projectId);if(['root','namespaceId','vaultId'].some(key=>latest[key]!==entry[key]))throw new AppError('ACCESS_LOCKED');return true;
}
