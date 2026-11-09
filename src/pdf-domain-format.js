import {AppError} from './errors.js';
import {parsePdfCrossReference} from './web/pdf-cross-reference-model.js';
import {pdfNoteHref} from './web/pdf-notes-model.js';
import {moduleDomainOwner} from './module-domain-owner.js';
const bad=()=>{throw new AppError('CATALOGUE_DAMAGED');};
// The authenticated owner is already copied by archive and rekey. An older
// application refuses its additional required field before any domain write.
export function pdfDomainFormat(owner,domain){
 if(!Object.hasOwn(owner??{},'pdfFormat'))return 1;
 if(domain!=='pdf'||!Number.isSafeInteger(owner.pdfFormat)||owner.pdfFormat<2)bad();
 if(owner.pdfFormat>6)throw new AppError('ACCESS_UPGRADE');return owner.pdfFormat;
}
function inlineReferences(node){
 if(!node||typeof node!=='object')return false;
 const href=node.marks?.find(mark=>mark.type==='link')?.attrs.href;
 if(href&&(pdfNoteHref(node)||parsePdfCrossReference(href)?.kind==='equation'))return true;
 return node.content?.some(inlineReferences)??false;
}
export function requiredPdfDomainFormat({header,section}={}){
 const caption=header?.structure?.caption;
 if(caption&&Object.hasOwn(caption,'numberEquations')||section?.notes?.some(note=>note.anchor==='inline'||inlineReferences(note.content))||inlineReferences(section?.content))return 6;
 if(section?.placementReview)return 5;
 if(header?.structure&&Object.hasOwn(header.structure,'printQrCodes'))return 4;
 if(header&&(Object.hasOwn(header,'printCondition')||header.press?.version===2))return 3;
 if(header&&(Object.hasOwn(header,'press')||Object.hasOwn(header,'outputProfile'))||section?.notes?.some(note=>note.kind==='page-footnote')||section?.research&&Object.hasOwn(section.research,'blockId'))return 2;
 return 1;
}
export const requiresPdfDomainFormat=value=>requiredPdfDomainFormat(value)>1;
async function ownerValue(store){
 if(!store.workspace?.vault)bad();const owner=await store.object('owner'),expected=moduleDomainOwner(store.workspace,store.namespaceId);
 if(!owner||store.domain!=='pdf'||Object.keys(owner).sort().join()!==['domain','namespaceId','projectId','vaultId','version',...(Object.hasOwn(owner,'pdfFormat')?['pdfFormat']:[])].sort().join()||owner.domain!==store.domain||owner.version!==expected.version||owner.projectId!==expected.projectId||owner.namespaceId!==store.namespaceId||owner.vaultId!==store.workspace.vault.id)bad();
 return {owner,format:pdfDomainFormat(owner,store.domain)};
}
export async function requirePdfDomainFormat(store,required=2){
 if(!store.writable)throw new AppError('INVALID');const {owner,format}=await ownerValue(store);if(![2,3,4,5,6].includes(required))throw new AppError('INVALID');if(format<required)await store.putObject('owner',{...owner,pdfFormat:required});
}
export async function assertPdfDomainFormat(store,required=2){if((await ownerValue(store)).format<required)bad();}
