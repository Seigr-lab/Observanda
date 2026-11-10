import {calendarDate} from './record-date.js';

function hasFields(value,keys){
 return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}

export function validCalibrationCoverage(value){
 return hasFields(value,['from','expiry','through'])&&(value.from===null||calendarDate(value.from))&&
  ['dated','open','unknown'].includes(value.expiry)&&(value.expiry==='dated'?calendarDate(value.through):value.through===null)&&
  (!value.from||!value.through||value.from<=value.through);
}

// Days are the declared calendar dates on the evidence and the observation.
// No wall clock, time-zone conversion, or numeric correction participates.
export function calibrationStatus(reference,review){
 if(!reference)return 'missing';
 const bounds=review?.coverage;
 if(!bounds)return 'unknown';
 if(!calendarDate(review.on))return 'undated';
 if(bounds.from&&review.on<bounds.from)return 'future';
 if(bounds.through&&review.on>bounds.through)return 'expired';
 if(!bounds.from||bounds.expiry==='unknown')return 'unknown';
 return 'valid';
}

export function validCalibrationReview(value,reference){
 return hasFields(value,['version','on','policy','coverage'])&&value.version===1&&
  (value.on===null||calendarDate(value.on))&&['inform','require-valid'].includes(value.policy)&&
  (value.coverage===null||reference?.kind==='analysis'&&validCalibrationCoverage(value.coverage))&&
  (value.policy!=='require-valid'||calibrationStatus(reference,value)==='valid');
}
