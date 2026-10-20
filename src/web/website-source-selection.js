import {researchId} from './research-reference.js';
export function validWebsiteSourceOperation(value){
 if(!value||value.type!=='source-selection'||!researchId(value.workspaceId)||!['record','attachment','project','remove','edition'].includes(value.kind))return false;
 if(Object.keys(value).some(name=>!['type','kind','workspaceId','labBookId','projectId','recordId','attachmentId','share','collection','value','key'].includes(name))||value.labBookId!==undefined&&!researchId(value.labBookId))return false;
 if(value.kind==='remove')return !['projectId','recordId','attachmentId','share','collection','value','key'].some(name=>Object.hasOwn(value,name));
 if(value.kind==='edition')return ['editionRecords','history','availability'].includes(value.collection)&&typeof value.key==='string'&&value.key.length<=2048&&Object.hasOwn(value,'value')&&!['projectId','recordId','attachmentId','share'].some(name=>Object.hasOwn(value,name));
 return researchId(value.projectId)&&typeof value.share==='boolean'&&!['collection','value','key'].some(name=>Object.hasOwn(value,name))&&(value.kind==='project'?value.recordId===undefined&&value.attachmentId===undefined:researchId(value.recordId)&&(value.kind==='attachment'?researchId(value.attachmentId):value.attachmentId===undefined));
}
