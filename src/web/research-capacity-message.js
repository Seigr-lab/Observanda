import {t} from './i18n/index.js';
const owners=new Set(['record','metadata','recordSelection','recordCommand','recordCheckpoint','checkpointRequest']);
export function researchCapacityMessage(error){
 const issue=Array.isArray(error?.details)?error.details.find(item=>item?.kind==='research-capacity'&&owners.has(item.owner)):null;
 if(!issue||!Number.isSafeInteger(issue.requestedBytes)||!Number.isSafeInteger(issue.limitBytes))return null;
 const owner=t('researchCapacity',issue.owner),amount=t('researchCapacity','amount',{owner,requested:issue.requestedBytes,limit:issue.limitBytes});
 const guidance=t('researchCapacity',['recordCheckpoint','checkpointRequest'].includes(issue.owner)?'checkpointGuidance':issue.owner==='recordSelection'?'selectionGuidance':'saveGuidance');
 return amount+' '+guidance;
}
