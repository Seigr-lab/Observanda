import path from 'node:path';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {WebsiteFilesCandidate} from '../../src/website-files-candidate.js';
import {PublicationConversion} from '../../src/publication-conversion.js';
import {executeResearchRequest} from '../../src/research-requests.js';
import {websitePublicationMetadata} from '../../src/website-publication-metadata.js';
import {recordRelease} from '../../src/website-release-ledger.js';
import {placedReleaseRecords} from '../../src/website-release-records.js';
import {contentBuffer} from '../../src/file-content.js';

// Websites made in the website editor show shared records through their placed
// copies. A completed delivery records which record revisions it showed.
export function editorWebsites(f){
 const store=new WebsiteFileStore(f.ws),conversion=new PublicationConversion(f.ws,{store});
 const command=(name,data)=>executeResearchRequest(f.ws,'/api/research/records/'+name,data,{publicationConversion:conversion});
 return {store,conversion,
  async share(record){const identity={workspaceId:f.book.id,recordId:record.id},base=await command('values/read',{...identity,field:'share'});await command('values/save',{...identity,field:'share',expectedRevision:base.revision,value:{value:true}});},
  async place(name,record){
   const notebook=f.book.notebooks.find(item=>item.id===record.notebookId),sourceId=websiteSourceId({workspaceId:f.book.id,projectId:notebook.projectId,notebookId:notebook.id,recordId:record.id});
   const created=await store.create({name});await store.insertSource(created.site.id,{expectedRevision:created.site.revision,sourceId});return created.site.id;
  },
  async publish(siteId){
   const revision=(await store.open(siteId)).site.revision,candidate=await WebsiteFilesCandidate.open(store,siteId,revision),metadata=websitePublicationMetadata(await store.publicationWorkspace(siteId));
   await recordRelease(metadata,{releaseId:candidate.id,revision,version:null,edition:'website',destination:{kind:'folder',directory:path.join(f.directory,'published',siteId)},completedAt:new Date().toISOString()},{records:await placedReleaseRecords(store,siteId,revision)});
   return {releaseId:candidate.id,text:await siteText(candidate)};
  },
  // The author updates the website's copy from the lab book, as the editor offers before publishing.
  refresh(record){return conversion.refreshRecord(f.ws,{workspaceId:f.book.id,notebookId:record.notebookId,recordId:record.id});}
 };
}
async function siteText(candidate){const parts=[];for(const [name,content] of candidate.files)if(/\.(html|css|json)$/.test(name))parts.push((await contentBuffer(content)).toString('utf8'));return parts.join('\n');}

