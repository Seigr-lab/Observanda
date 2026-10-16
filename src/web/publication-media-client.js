import {publicationOwnerWindows} from './publication-owner-windows.js';
import {researchId} from './research-reference.js';
import {t} from './i18n/index.js';
export function publicationMediaClient({state,api,research,...options}){
 return publicationOwnerWindows({state,api,...options,operation:'source-media',limit:12,local:({signal,...query})=>research.query('media',query,{signal}),errorMessage:()=>t('websiteContent','invalid'),key:item=>item.key,
  validate:(item,source)=>item.owner?.workspaceId===source.workspaceId&&(item.owner.projectId===null||researchId(item.owner.projectId))&&(item.owner.labBookId===null||researchId(item.owner.labBookId)&&researchId(item.owner.projectId))&&researchId(item.entryId)&&item.record?.id===item.entryId&&researchId(item.record.notebookId)&&typeof item.record.title==='string'&&researchId(item.sourceAttachmentId)&&researchId(item.asset?.id)&&['image','audio','video','file'].includes(item.asset.kind)&&item.asset.share===true&&typeof item.asset.caption==='string'&&typeof item.asset.alt==='string'&&item.key===item.entryId+':'+item.asset.id&&typeof item.label==='string'});
}
