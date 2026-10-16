import {publicProjection,renderPublication} from './publication.js';
import {publicationPage} from './publication-page.js';
import {AppError} from './errors.js';

// The composer receives one authenticated, non-exportable page. Other pages
// remain link destinations; their media, figures and documents are not built.
export async function websitePreview(book,{designTarget,blockedValues=[],media,fonts,signal}={}){
 signal?.throwIfAborted();
 const options={designTarget,workspaceContent:true,singlePage:true,blockedValues};
 return renderWebsitePreview(publicProjection(book,options),{designTarget,blockedValues,media,fonts,signal});
}

// Accept only a server-admitted projection; source/selection is a separate owner.
export async function renderWebsitePreview(context,{designTarget,blockedValues=[],media,fonts,signal}={}){
 signal?.throwIfAborted();
 const options={designTarget,workspaceContent:true,singlePage:true,blockedValues},plan=publicationPage(context,designTarget);
 const mediaFiles=new Map();
 for(const [id,kind] of plan.media){
  signal?.throwIfAborted();
  const file=await media.get(id,{streamed:true,signal});
  if(file.kind!==kind)throw new AppError('MEDIA_INVALID');
  mediaFiles.set(id,file);
 }
 signal?.throwIfAborted();
 const fontFiles=await fonts.files(plan.fonts,{preview:true,signal});
 signal?.throwIfAborted();
 const candidate=renderPublication(context,{...options,mediaFiles,fontFiles});
 signal?.throwIfAborted();
 return candidate;
}
