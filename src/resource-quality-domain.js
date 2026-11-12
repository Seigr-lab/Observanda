import {AppError} from './errors.js';
export const usesResourceQuality=entity=>entity?.type==='booking'?Object.hasOwn(entity.data,'qualityAtReservation'):entity?.type==='resource'?Object.hasOwn(entity.data,'quality'):['reservation','movement'].includes(entity?.type)&&Object.hasOwn(entity.data,'qualityAtUse');
export async function assertResourceQualityFormat(store){
 const owner=store.domain&&await store.object('owner');
 if(!owner||resourceQualityFormat(owner,store.domain)!==1)throw new AppError('CATALOGUE_DAMAGED');
}

export function resourceQualityFormat(owner,domain){
 if(!Object.hasOwn(owner,'resourceQualityFormat'))return 0;
 if(!['inventory','equipment','samples'].includes(domain)||!Number.isSafeInteger(owner.resourceQualityFormat)||owner.resourceQualityFormat<1)throw new AppError('CATALOGUE_DAMAGED');
 if(owner.resourceQualityFormat>1)throw new AppError('ACCESS_UPGRADE');
 return owner.resourceQualityFormat;
}

// Called inside the same locked domain transaction as the first typed record.
export async function requireResourceQualityFormat(store){
 if(!['inventory','equipment','samples'].includes(store.domain))throw new AppError('ACCESS_UPGRADE');
 if(!store.writable)throw new AppError('INVALID');
 const owner=await store.object('owner');
 if(!owner||owner.domain!==store.domain||owner.namespaceId!==store.namespaceId||owner.vaultId!==store.workspace.vault.id)throw new AppError('CATALOGUE_DAMAGED');
 if(!resourceQualityFormat(owner,store.domain))await store.putObject('owner',{...owner,resourceQualityFormat:1});
}
