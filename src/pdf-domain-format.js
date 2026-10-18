import {AppError} from './errors.js';
import {moduleDomainOwner} from './module-domain-owner.js';
const bad=()=>{throw new AppError('CATALOGUE_DAMAGED');};
// The authenticated owner is already copied by archive and rekey. An older
// application refuses its additional required field before any domain write.
export function pdfDomainFormat(owner,domain){
 if(!Object.hasOwn(owner??{},'pdfFormat'))return 1;
 if(domain!=='pdf'||!Number.isSafeInteger(owner.pdfFormat)||owner.pdfFormat<2)bad();
 if(owner.pdfFormat>4)throw new AppError('ACCESS_UPGRADE');return owner.pdfFormat;
}
export function requiredPdfDomainFormat(value={}){return value.header?.structure&&Object.hasOwn(value.header.structure,'printQrCodes')?4:value.header&&(Object.hasOwn(value.header,'printCondition')||value.header.press?.version===2)?3:requiresPdfDomainFormat(value)?2:1;}
export function requiresPdfDomainFormat({header,section}={}){
 return !!(header&&(Object.hasOwn(header,'press')||Object.hasOwn(header,'outputProfile')||Object.hasOwn(header,'printCondition')||header.structure&&Object.hasOwn(header.structure,'printQrCodes'))||section?.notes?.some(note=>note.kind==='page-footnote')||section?.research&&Object.hasOwn(section.research,'blockId'));
}
async function ownerValue(store){
 if(!store.workspace?.vault)bad();const owner=await store.object('owner'),expected=moduleDomainOwner(store.workspace,store.namespaceId);
 if(!owner||store.domain!=='pdf'||Object.keys(owner).sort().join()!==['domain','namespaceId','projectId','vaultId','version',...(Object.hasOwn(owner,'pdfFormat')?['pdfFormat']:[])].sort().join()||owner.domain!==store.domain||owner.version!==expected.version||owner.projectId!==expected.projectId||owner.namespaceId!==store.namespaceId||owner.vaultId!==store.workspace.vault.id)bad();
 return {owner,format:pdfDomainFormat(owner,store.domain)};
}
export async function requirePdfDomainFormat(store,required=2){
 if(!store.writable)throw new AppError('INVALID');const {owner,format}=await ownerValue(store);if(![2,3,4].includes(required))throw new AppError('INVALID');if(format<required)await store.putObject('owner',{...owner,pdfFormat:required});
}
export async function assertPdfDomainFormat(store,required=2){if((await ownerValue(store)).format<required)bad();}
