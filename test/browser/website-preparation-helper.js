import {expect} from '@playwright/test';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {lastWebsiteLibraryDiscovery} from '../../src/website-library-discovery.js';
// Opening a workspace prepares its saved websites once, in the background and
// under the workspace writer, reading every project's sources. A spec that
// holds that writer or measures owner independence starts after it finishes.
export async function websitePreparationFinished(page,{timeout=180000}={}){
 // A run requested just now (a project unlock retries discovery) may not have
 // reported yet, so the finished state must still hold a second later.
 for(let check=0;check<2;check++){if(check)await page.waitForTimeout(1000);await finished(page,timeout);}
}
async function finished(page,timeout){
 await expect.poll(()=>page.evaluate(async()=>{
  const storage=await fetch('/api/storage').then(response=>response.json());
  const response=await fetch('/api/website-files/preparation',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},body:'{}'});
  if(!response.ok)return 'unavailable '+response.status;
  const {preparation}=await response.json(),activity=await fetch('/api/activity').then(response=>response.json());
  if(activity.operations.some(item=>item.kind==='website-preparation'&&['queued','running'].includes(item.state)))return 'running';
  if(!preparation?.library||preparation.library.state==='preparing')return preparation?.state??'unknown';
  return preparation.state;
 }),{timeout}).toBe('ready');
}

// Sign-in preparation discovers the lab book records shared for websites. Specs
// wait for it before they place records or measure other work.
export async function websiteLibraryState(workspace){return (await lastWebsiteLibraryDiscovery(new WebsiteFileStore(workspace)))?.state??null;}
// The author makes a website in the website editor and places shared records
// on its home page; the library offers them once discovery has finished.
export async function websiteWithRecords(workspace,book,records,{name='Field notes'}={}){
 const store=new WebsiteFileStore(workspace),created=await store.create({name});let revision=created.site.revision;
 for(const record of records){
  const notebook=book.notebooks.find(item=>item.id===record.notebookId),sourceId=websiteSourceId({workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,recordId:record.id});
  revision=(await store.insertSource(created.site.id,{expectedRevision:revision,sourceId})).site.revision;
 }
 return {store,siteId:created.site.id,revision};
}
