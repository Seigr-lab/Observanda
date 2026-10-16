import {AppError} from './errors.js';
import {validPublicationSources} from './web/publication-sources-model.js';
import {researchId} from './web/research-reference.js';
import {PublicationPreviewOwner} from './publication-preview-owner.js';
import {PublicationOwnerIdentities} from './publication-owner-identities.js';
import {selectorAnchor} from './web/book-selectors.js';

// Resolve a public page through its selected source and edition. Excluded
// sections cannot become link destinations, including historical pages.
export async function publicationSourceSections(store,snapshot,pinned,host,query,{signal}={}){
 const {source,target,offset}=query;
 if(Object.keys(query).sort().join()!=='offset,snapshotId,source,target,workspaceId'||!validPublicationSources([source])||source.workspaceId!==snapshot.metadata.id||typeof target!=='string'||!target.startsWith('entry:')||!researchId(target.slice(6))||!Number.isSafeInteger(offset)||offset<0||offset%25)throw new AppError('INVALID');
 const reader={use:async(_id,_revision,consume)=>({value:await consume(store,snapshot,pinned)})};
 const owner=await new PublicationPreviewOwner(source,reader,new PublicationOwnerIdentities(host.workspaceId),{signal}).initialize(),row=await owner.find(target.slice(6));
 if(!row)throw new AppError('NOT_FOUND');
 const descriptor=await owner.describe(row),sections=descriptor.selectors.filter(selector=>selector.kind==='section');
 if(offset>=sections.length&&offset!==0)throw new AppError('INVALID');
 return {workspaceId:source.workspaceId,snapshotId:pinned.snapshotId,target,items:sections.slice(offset,offset+25).map(section=>({id:selectorAnchor(section),title:section.label??''})),offset,total:sections.length,previous:offset?offset-25:null,next:offset+25<sections.length?offset+25:null};
}
