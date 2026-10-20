import {pdfDomainFormat} from './pdf-domain-format.js';
// The encrypted root manifest makes a missing whole domain detectable.
import {moduleDomainOwner} from './module-domain-owner.js';
import {AppError} from './errors.js';
import {catalogueFormat,catalogueRequiresDomains,requireProjectDomains,requireWorkspaceDomains} from './catalogue-format.js';
import {validModuleDomain} from './modules/domains.js';
import {projectDomainSchemas} from './project-domain-schema.js';
export const projectDomainRegistrySlot='project-domains';
export async function readProjectDomainRegistry(store){
 const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',projectDomainRegistrySlot),format=await catalogueFormat(store.db);
 // Feature generations can add a directory without creating module domains.
 // Retain the earlier project-generation contract, then use its explicit flag.
 if(!row){if(catalogueRequiresDomains(format)||store.workspace.projectId&&format>=22&&format<50)throw new AppError('CATALOGUE_DAMAGED');return null;}
 const value=store.decode('state',projectDomainRegistrySlot,row.payload),owner=moduleDomainOwner(store.workspace,(await store.snapshot()).metadata.id);
 if(format<22||!value||Object.keys(value).sort().join()!==['version','projectId','namespaceId','domains',...(value.commandVersion===1?['commandVersion']:[]),...(value.authoringVersion===1?['authoringVersion']:[])].sort().join()||value.authoringVersion===1&&value.commandVersion!==1||value.version!==owner.version||value.projectId!==owner.projectId||owner.version===2&&format<24||!Array.isArray(value.domains)||!value.domains.length||!value.domains.every(validModuleDomain)||new Set(value.domains).size!==value.domains.length||[...value.domains].sort().join()!==value.domains.join()||owner.namespaceId!==value.namespaceId)throw new AppError('CATALOGUE_DAMAGED');
 return value;
}
export async function writeProjectDomainRegistry(store,domains,namespaceId,{commandVersion,authoringVersion}={}){
 await (store.workspace.projectId?requireProjectDomains:requireWorkspaceDomains)(store.db);
 const value={...moduleDomainOwner(store.workspace,namespaceId),domains:[...domains].sort(),...(commandVersion===1?{commandVersion}: {}),...(authoringVersion===1?{authoringVersion}:{})};
 await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',projectDomainRegistrySlot,store.encode('state',projectDomainRegistrySlot,value));
}
export async function checkProjectDomainSchemas(store,registry){
 const actual=await projectDomainSchemas(store.db);
 if(actual.join()!==(registry?.domains??[]).join())throw new AppError('CATALOGUE_DAMAGED');
}

export async function checkProjectDomainOwner(store){
 const versions=await store.db.all('SELECT version FROM domain_format');if(versions.length!==1||versions[0].version!==1)throw new AppError('CATALOGUE_DAMAGED');
 const owner=await store.object('owner'),expected=moduleDomainOwner(store.workspace,store.namespaceId);
 if(!owner||Object.keys(owner).sort().join()!==['domain','namespaceId','projectId','vaultId','version',...(Object.hasOwn(owner,'pdfFormat')?['pdfFormat']:[])].sort().join()||owner.version!==expected.version||owner.projectId!==expected.projectId||owner.namespaceId!==store.namespaceId||owner.domain!==store.domain||owner.vaultId!==store.workspace.vault.id)throw new AppError('CATALOGUE_DAMAGED');
 pdfDomainFormat(owner,store.domain);
}
