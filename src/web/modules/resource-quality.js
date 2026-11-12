import {calendarDate} from '../record-date.js';
import {validMaterialReference} from '../material-reference.js';
import {validCalibrationCoverage,calibrationStatus} from '../measurement-calibration.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const string=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/u.test(value)&&(!required||Boolean(value.trim()));
const optionalDate=value=>value===null||calendarDate(value);
const workflows=['reserve','use','run'];
const reference=value=>exact(value,['kind','id','revision','workspaceId'])&&validMaterialReference(value)&&typeof value.workspaceId==='string';

export function validResourceQuality(value,resourceKind){
 if(!value||value.version!==1||!string(value.holdReason,500)||!exact(value.policy,workflows)||
   !workflows.every(step=>['warn','block'].includes(value.policy[step])))return false;
 if(value.kind==='lot')return resourceKind==='material'&&
  exact(value,['version','kind','number','supplier','evidence','expiresOn','retestOn','holdReason','policy'])&&
  string(value.number,160,true)&&string(value.supplier,240)&&optionalDate(value.expiresOn)&&optionalDate(value.retestOn)&&
  (value.evidence===null||reference(value.evidence));
 return resourceKind==='equipment'&&value.kind==='equipment'&&
  exact(value,['version','kind','certificate','coverage','holdReason','policy'])&&
  (value.certificate===null?value.coverage===null:reference(value.certificate)&&value.certificate.kind==='analysis'&&!!validCalibrationCoverage(value.coverage));
}

export function qualityAssessment(quality,workflow,on){
 if(!workflows.includes(workflow)||!calendarDate(on))throw new TypeError('Invalid readiness assessment');
 const issues=[];
 if(quality.holdReason)issues.push('hold');
 if(quality.kind==='lot'){
  if(quality.expiresOn&&on>quality.expiresOn)issues.push('expired');
  if(quality.retestOn&&on>=quality.retestOn)issues.push('retest');
 }else{
  const status=calibrationStatus(quality.certificate,{on,coverage:quality.coverage});
  if(status!=='valid')issues.push('calibration-'+status);
 }
 const policy=quality.policy[workflow];
 return {workflow,on,policy,issues,blocked:policy==='block'&&issues.length>0};
}

// The date of stock use is explicitly shown in UTC. A scheduled activity
// uses the IANA timezone saved on that booking.
export function qualityDay(instant,zone='UTC'){
 if(zone==='UTC')return instant.slice(0,10);
 const parts=new Intl.DateTimeFormat('en',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:zone}).formatToParts(new Date(instant));
 const value=type=>parts.find(part=>part.type===type).value;
 return value('year')+'-'+value('month')+'-'+value('day');
}
