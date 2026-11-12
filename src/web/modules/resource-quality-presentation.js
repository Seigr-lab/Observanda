import '../i18n/catalogues/resourceQuality.js';
import {t} from '../i18n/index.js';
export const qualityText=key=>t('resourceQuality',key);

export function readinessText(value,quality,tr=qualityText){
 const status=value.blocked?'blocked':value.issues.length?'warning':'ready';
 return [tr(status),...value.issues.map(tr),...(value.issues.includes('hold')&&quality?.holdReason?[quality.holdReason]:[])].join(' · ');
}
export function retainedQualityText(snapshot,tr=qualityText){
 const q=snapshot.quality,ref=q.kind==='lot'?q.evidence:q.certificate;
 const parts=[snapshot.name,tr('revision')+' '+snapshot.resourceRevision,
  q.kind==='lot'?tr('lotNumber')+' '+q.number:tr('certificate'),
  tr('assessed')+' '+snapshot.on,readinessText(snapshot,q,tr),tr(snapshot.policy)];
 if(q.kind==='lot'&&q.supplier)parts.push(tr('supplier')+' '+q.supplier);
 if(q.expiresOn)parts.push(tr('expiresOn')+' '+q.expiresOn);
 if(q.retestOn)parts.push(tr('retestOn')+' '+q.retestOn);
 if(q.coverage)parts.push(tr('from')+' '+(q.coverage.from??tr('unknownCoverage')),tr('through')+' '+(q.coverage.through??tr(q.coverage.expiry==='open'?'openCoverage':'unknownCoverage')));
 if(ref)parts.push(tr('reference')+' '+ref.workspaceId+' / '+ref.id+' / '+ref.revision);
 return parts.join(' · ');
}
