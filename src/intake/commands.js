import {withComparisonInputs} from '../comparison-request-inputs.js';
import {MAX_BYTES} from '../model.js';
// The local CLI and authenticated UI share this versioned command boundary.
import {AppError} from '../errors.js';
import {LocalIntake} from './service.js';
import {RunReadiness} from '../run-readiness.js';
export async function intakeCommand(workspace,queue,action,command,options={}){
 if(!command||command.version!==1)throw new AppError('INTAKE_INVALID');
 const {version,...input}=command;void version;
 const service=new LocalIntake(workspace,queue);
 if(action==='readiness'){const readiness=new RunReadiness(workspace);return withComparisonInputs(readiness.materials,options,inputs=>readiness.view(input,{...options,inputs}));}
 if(action==='receipt-editions')return new RunReadiness(workspace).editions(input,options);
 if(action==='link-receipt')return new RunReadiness(workspace).link(input);
 if(action==='policy')return new RunReadiness(workspace).setPolicy(input);
 if(['preview','stage','apply','status','list'].includes(action))return service[action](input,options);
 if(action==='cancel'||action==='resume')return service.control(input,action==='resume'?'retry':'cancel');
 throw new AppError('NOT_FOUND');
}

const readActions=new Set(['readiness','receipt-editions','preview','status','list']);
const writeActions=new Set(['link-receipt','policy','stage','apply','cancel','resume']);
export function intakeRequest(route){
 const prefix='/api/v1/intake/';if(!route.startsWith(prefix))return null;const action=route.slice(prefix.length);
 return readActions.has(action)||writeActions.has(action)?{intake:action,write:writeActions.has(action),limit:MAX_BYTES}:null;
}
