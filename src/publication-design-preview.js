// Build an editor preview from its explicitly supplied content owner.
import {websitePreviewSource} from './website-preview-source.js';
import {websitePreview,renderWebsitePreview} from './website-preview.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {MediaStore} from './media.js';
import {upgradeNotebook} from './model.js';
import {sampleNotebook} from './sample.js';
import {selectedContent} from './web/website-model.js';
import {buildDesignExamples} from './design-preview.js';
import {publicProjection,buildPublication} from './publication.js';
import {AppError} from './errors.js';
export async function publicationDesignPreview(workspace,data,{signal,blockedValues=[]}={}){
 const mode=data.mode??'auto';if(!['auto','examples','website'].includes(mode))throw new AppError('INVALID');
 let book,context;
 if(Object.hasOwn(data,'draft')){
  if(Object.keys(data).some(key=>!['draft','mode','designTarget','designPageId','workspaceContent','referenceCursor','collections'].includes(key))||mode!=='website'||data.workspaceContent!==true||!data.designTarget)throw new AppError('INVALID');
  ({metadata:book,context}=await websitePreviewSource(workspace,data.draft,{designTarget:data.designTarget,referenceCursor:data.referenceCursor,collections:data.collections,signal}));
 }else if(data.book){if(workspace.websiteId)throw new AppError('INVALID');book=upgradeNotebook(data.book);}
 else{book=sampleNotebook();book.appearance=data.appearance;}
 const selection=mode==='auto'&&data.book?selectedContent(book):null,source=mode==='auto'?(selection&&(selection.entries.length||selection.pages.length)?'website':'examples'):mode;
 const designPageId=data.designPageId??null,designTarget=data.designTarget??null,workspaceContent=data.workspaceContent===true;
 if(designTarget!==null&&(source!=='website'||typeof designTarget!=='string'||designTarget.length>100)||designPageId!==null&&(source!=='website'||typeof designPageId!=='string'||!book.pages.some(p=>p.id===designPageId))||workspaceContent&&(source!=='website'||!designTarget))throw new AppError('INVALID');
 const canvas=source==='website'&&workspaceContent&&designTarget,fonts=new WorkspaceFonts(workspace),media=new MediaStore(workspace),fontFiles=canvas?new Map():await fonts.files(source==='examples'?book.appearance:publicProjection(book,{designPageId,designTarget,workspaceContent}),{preview:true});
 signal?.throwIfAborted();
 const result=canvas?{candidate:await (context?renderWebsitePreview:websitePreview)(context??book,{designTarget,blockedValues,media,fonts,signal})}:source==='examples'?buildDesignExamples(book.appearance,{blockedValues,fontFiles}):{candidate:buildPublication(book,{blockedValues,fontFiles,designPageId,designTarget,workspaceContent,mediaFiles:await media.publicFiles(book,{streamed:true,designPageId,designTarget,workspaceContent})})};
 signal?.throwIfAborted();const defaultPage=result.defaultPage??result.candidate.defaultPage;if(!defaultPage)throw new AppError('PUBLICATION_EMPTY');return {...result,defaultPage,source};
}
