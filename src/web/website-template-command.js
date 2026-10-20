import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
const target=value=>value==='home'||typeof value==='string'&&/^(page|template|project|notebook|entry):/.test(value)&&researchId(value.slice(value.indexOf(':')+1));
export function validWebsiteTemplateOperation(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const exact=names=>Object.keys(value).sort().join()===names.sort().join();
 if(value.type==='template-derive')return exact(['type','templateId','id','name'])&&researchId(value.templateId)&&researchId(value.id)&&typeof value.name==='string'&&value.name.trim().length>0&&value.name.length<=80&&!/[\u0000-\u001f]/u.test(value.name);
 if(!target(value.target))return false;
 if(value.type==='template-detach')return exact(['type','target']);
 if(value.type==='template-link')return exact(['type','target','templateId','mode'])&&researchId(value.templateId)&&['append','replace'].includes(value.mode);
 if(value.type==='template-update')return exact(['type','target','templateId'])&&researchId(value.templateId);
 if(value.type==='template-accept')return exact(['type','target','token','decisions'])&&revisionId(value.token)&&value.decisions&&typeof value.decisions==='object'&&!Array.isArray(value.decisions)&&Object.keys(value.decisions).length<=10000&&Object.entries(value.decisions).every(([key,choice])=>key.length<=240&&!['__proto__','constructor','prototype'].includes(key)&&['local','template'].includes(choice));
 return false;
}
