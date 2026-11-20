import {transformStructure} from './structure.js';
import {catalogueOutline} from './catalogue-outline.js';

// Reorganization previews need ownership counts and metadata, not originals as
// an editable book. No index nodes or snapshots are written during this read.
export async function legacyStructurePreview(store,source,change,etag,{signal}={}){
 const result=transformStructure({...source.metadata,entries:[]},'reorganize',change),metadata={...result.book,entries:[]};
 await store.validateMetadata(source,metadata);
 const counts=await catalogueOutline(store,source,{signal});
 result.summary.records=metadata.notebooks.filter(n=>n.projectId===result.projectId).reduce((sum,n)=>sum+counts.notebookCounts[n.id],0);
 signal?.throwIfAborted();return {summary:result.summary,etag};
}
