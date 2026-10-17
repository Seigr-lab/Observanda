import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {validWebsitePin} from './web/website-pin.js';

// An explicit default website is distinct from an unscoped research request.
export function websiteRequestContext(headers){
 const owner=headers['x-observanda-website'],raw=headers['x-observanda-website-pin'];
 if(owner===undefined){if(raw!==undefined)throw new AppError('INVALID');return {websiteContext:false,websiteId:null,websitePin:undefined};}
 if(owner!=='default'&&!researchId(owner))throw new AppError('INVALID');
 const websiteId=owner==='default'?null:owner;let websitePin;
 if(raw!==undefined){
  try{if(typeof raw!=='string'||raw.length>1024)throw Error();websitePin=JSON.parse(raw);}catch{throw new AppError('INVALID');}
  if(!validWebsitePin(websitePin)||websitePin.websiteId!==websiteId)throw new AppError('INVALID');
 }
 return {websiteContext:true,websiteId,websitePin};
}
