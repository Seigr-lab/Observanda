import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {createWebsiteWorkspace,selectEntry} from './website-workspace-fixture.js';

export const previousWebsiteVersion='0.3.0-alpha.21';
export const previousWorkspaceName='Prior website workspace';
export const previousSiteName='Optics field journal';
export const previousHomeText='A field journal saved in the previous website editor.';
export const previousDefaultText='Saved writing from the original workspace website.';

// Only the predecessor runs here. Save through the same editor endpoints that
// its renderer used. Neither website is prepared, exported or converted.
export async function createPreviousWebsites(fixture,program){
 const workspace=path.join(fixture.directory,previousWorkspaceName);
 const app=await fixture.start(program,{expectedVersion:previousWebsiteVersion});
 try{
  const page=await app.firstWindow();
  await createWebsiteWorkspace(page,fixture.directory,previousWorkspaceName);
  const source=await selectEntry(page);
  const siteId=await page.evaluate(async({source,siteName,namedText,defaultText})=>{
   const headers={'Content-Type':'application/json','X-Observanda-Workspace':source.context,'X-Observanda-Wait':'1'};
   async function call(endpoint,data){
    const response=await fetch('/api/websites/'+endpoint,{method:'POST',headers,body:JSON.stringify(data)});
    const result=await response.json();if(!response.ok)throw Error(endpoint+' returned '+(result.code??response.status));
    return result;
   }
   let sites=await call('list',{});
   async function save(websiteId,operations){
    const owner={websiteId,workspaceId:sites.workspaceId},opened=await call('editor/open',owner);
    const draft=await call('editor/change',{...owner,websitePin:opened.websitePin,draftId:null,expectedRevision:null,commandId:crypto.randomUUID(),operations});
    const saved=await call('editor/save',{...owner,websitePin:draft.websitePin,draftId:draft.draft.id,expectedRevision:draft.draft.revision,commandId:crypto.randomUUID()});
    if(!saved.websitePin?.websiteRevision||saved.draft)throw Error('Prior editor did not confirm the saved website.');
   }
   const home=(title,body,sections=[])=>({type:'settings',path:['document','website','home'],value:{enabled:true,title,showTitle:true,introduction:body,sections}});
   await save(null,[home('Workspace homepage',defaultText)]);
   sites=await call('list',{});
   const named=await call('change',{workspaceId:sites.workspaceId,etag:sites.etag,operation:'create',name:siteName,projectId:null});
   await save(named.id,[
    home('Field observations',namedText,[{id:'records',kind:'records',title:'Selected research',show:true,layout:'list'}]),
    {type:'append',collection:'pages',values:[{id:crypto.randomUUID(),title:'Methods',body:'Authored methods page from the previous editor.',share:true,sections:[]}]},
    {type:'source-selection',kind:'record',workspaceId:source.workspaceId,labBookId:source.labBookId,projectId:source.projectId,recordId:source.recordId,share:true}
   ]);
   return named.id;
  },{source,siteName:previousSiteName,namedText:previousHomeText,defaultText:previousDefaultText});
  await assert.rejects(stat(path.join(workspace,'.observanda','website-files')),{code:'ENOENT'});
  return {siteId,roots:[workspace,...source.roots]};
 }finally{await fixture.close(app);}
}
