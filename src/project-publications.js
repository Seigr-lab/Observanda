import {WorkspaceEdits} from './workspace-edits.js';
import {MediaStore} from './media.js';
import {websiteWorkspace} from './website-workspace.js';
import {websitePublisher} from './workspace-jobs.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';

// Publication requests for a project or lab book owner: saving its workspace
// edits, its GitHub connection and the publishing settings Integrations reads.
// Websites are made and published in the website editor.
export class ProjectPublications{
 constructor(entry){this.entry=entry;}
 clear(){}
 run(request,data,options){
  // Publication sessions retain their own authenticated owner, distinct from
  // the short-lived router owner. Scope its connections to this request too.
  return this.entry.storage.withCatalogueConnections(()=>this.runConnected(request,data,options));
 }
 async runConnected(request,data,{websiteId=null,websitePin,signal,headless=true,check=async()=>{}}={}){
  const {storage,publisher:basePublisher,queue:baseQueue}=this.entry,operation=request.publication;
  await check();signal?.throwIfAborted();if(websiteId!==null&&!researchId(websiteId))throw new AppError('INVALID');
  if(operation==='workspace/save')return new WorkspaceEdits(storage,new MediaStore(storage)).save(data);
  const publisher=websitePublisher(basePublisher,websiteWorkspace(storage,websiteId,{websitePin}));
  const githubIdle=async()=>{if(await baseQueue.hasActive(['publication.repository']))throw new AppError('GITHUB_PUBLICATION_BUSY');};
  if(operation.startsWith('github-connection/')){
   const method=operation.slice(18),connection=publisher.connection;
   if(!connection){if(method==='status')return {available:false,accounts:[],selected:null,connected:false,signIn:null,error:null};throw new AppError('GITHUB_HELPER_MISSING');}
   if(method==='status')return connection.status();if(method==='cancel')return connection.cancel();await githubIdle();
   if(method==='start'){if(headless)throw new AppError('GITHUB_BROWSER_UNAVAILABLE');publisher.token=null;return connection.start();}
   if(method==='choose'){publisher.token=null;return connection.choose(data.login);}if(method==='disconnect'){publisher.token=null;return connection.disconnect({forget:data.forget===true});}
   throw new AppError('INVALID');
  }
  if(operation==='publishing')return publisher.read();
  if(operation==='publishing/connect'){await githubIdle();await publisher.connection?.cancel();return publisher.connect(data.token);}
  if(operation==='publishing/disconnect'){await githubIdle();publisher.token=null;return publisher.read();}
  throw new AppError('NOT_FOUND');
 }
}
