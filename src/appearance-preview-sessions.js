import {randomBytes} from 'node:crypto';
import {appearancePreviewChoices,appearancePreviewPage,appearancePreviewRequest} from './appearance-preview.js';
import {DesignCandidates} from './design-candidates.js';
import {publicationPage} from './publication-page.js';
import {renderPublication,verifyPublicationManifest} from './publication.js';
import {AppError} from './errors.js';
import {feedFilePath} from './publication-feeds.js';

// Only active previews and a bounded cache live in memory. Evicting a rendered
// page loses no work: its pinned snapshot and appearance regenerate it exactly.
export class AppearancePreviewSessions{
 constructor({maxSessions=5,cache=new DesignCandidates()}={}){this.maxSessions=maxSessions;this.cache=cache;this.sessions=new Map();}
 clear(){this.sessions.clear();this.cache.clear();}
 async create(workspace,command,{media,fonts,blockedValues=[],signal}={}){
  const choices=await appearancePreviewChoices(workspace,command,{signal}),defaultPage=choices.pages[0]?.path;
  if(!defaultPage)throw new AppError('PUBLICATION_EMPTY');
  const id=randomBytes(32).toString('hex');
  while(this.sessions.size>=this.maxSessions)this.sessions.delete(this.sessions.keys().next().value);
  this.sessions.set(id,{workspace,command:structuredClone(command),media,fonts,blockedValues});
  try{await this.page(id,defaultPage,{signal});}catch(error){this.sessions.delete(id);throw error;}
  return {source:'website',...choices,defaultPage,baseUrl:'/appearance-preview/'+id+'/',url:'/appearance-preview/'+id+'/'+defaultPage,pagesUrl:'/api/appearance-preview/'+id+'/pages'};
 }
 get(id){const session=this.sessions.get(id);if(!session)throw new AppError('NOT_FOUND');return session;}
 async choices(id,options){const {workspace,command}=this.get(id);return appearancePreviewChoices(workspace,command,options);}
 async page(id,path,{signal}={}){
  signal?.throwIfAborted();
  const request=appearancePreviewRequest(path),session=this.get(id),key=id+':'+request.key,cached=this.cache.get(key);if(cached)return cached;
  const {workspace,command,media,fonts,blockedValues}=session;
  const context=await appearancePreviewPage(workspace,command,request.key,{signal}),plan=publicationPage(context,request.target),mediaFiles=new Map();
  for(const [id,kind] of plan.media){signal?.throwIfAborted();const file=await media.get(id,{streamed:true,signal});if(file.kind!==kind)throw new AppError('MEDIA_INVALID');mediaFiles.set(id,file);}
  const fontFiles=await fonts.files(plan.fonts,{preview:true,signal});signal?.throwIfAborted();
  const candidate=renderPublication(context,{blockedValues,mediaFiles,fontFiles,emitBrowse:false});
  verifyPublicationManifest(candidate);
  if(this.sessions.get(id)!==session)throw new AppError('NOT_FOUND');
  signal?.throwIfAborted();try{this.cache.set(key,candidate);}catch(error){if(error.code!=='DESIGN_PREVIEW_LIMIT')throw error;}return candidate;
 }
 async file(id,path,{signal}={}){
  const asset=/^_assets\/([A-Za-z0-9_-]+)\/(.+)$/.exec(path),page=asset?Buffer.from(asset[1],'base64url').toString('utf8'):path;
  if(asset&&Buffer.from(page).toString('base64url')!==asset[1])throw new AppError('NOT_FOUND');
  const request=appearancePreviewRequest(page),candidate=await this.page(id,request.key,{signal}),file=asset?asset[2]:request.path;
  if(!candidate.files.has(file)||asset&&!/^(styles\.css|public-(?:book|feeds)\.js|(?:media|fonts)\/[^/]+)$/.test(file)&&!feedFilePath(file))throw new AppError('NOT_FOUND');
  if(asset&&!feedFilePath(file))return {content:candidate.files.get(file),name:file};
  // Page links keep their normal relative destinations. Resources carry the
  // page identity so concurrent frames cannot overwrite each other's styles.
  const prefix='../'.repeat(request.path.split('/').length-1),key=Buffer.from(request.key).toString('base64url');let html=candidate.files.get(file);
  for(const name of candidate.files.keys())if(!name.endsWith('.html'))html=html.replaceAll('"'+prefix+name+'"','"'+prefix+'_assets/'+key+'/'+name+'"');
  const directory=request.path.slice(0,request.path.lastIndexOf('/')+1);
  html=html.replaceAll('&quot;source&quot;:&quot;feed-','&quot;source&quot;:&quot;'+prefix+'_assets/'+key+'/'+directory+'feed-');
  return {content:html,name:file};
 }
}
