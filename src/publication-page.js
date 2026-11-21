import {AppError} from './errors.js';

// A page plan is derived only from an admitted projection: the record's own
// media and the fonts its writing and the page settings use.
export function publicationPage(context,target){
 const [kind,id]=target?.split(':')??[],item=kind==='entry'?context.entries.find(value=>value.id===id):null;
 if(!item)throw new AppError('INVALID');
 const media=new Map(),fonts=[context.appearance,context.website.design.buttons,context.website.design.links,item.body,...item.sections.map(s=>s.body)];
 for(const attachment of item.attachments){if(media.has(attachment.id)&&media.get(attachment.id)!==attachment.kind)throw new AppError('MEDIA_INVALID');media.set(attachment.id,attachment.kind);}
 return {target,path:'entries/'+id+'.html',media,fonts,original:true,sections:[]};
}
