import {exact} from '../modules/validation.js';
import {AppError} from '../errors.js';

export const identityRecoveryStatus=Object.freeze({COLLABORATION_IDENTITY_CHANGED:409,COLLABORATION_IDENTITY_BUSY:423,COLLABORATION_IDENTITY_LOCK:423});
const parameters={state:[],backup:['password','confirmation'],inspect:['file','password'],restore:['file','password','expected','verified'],activate:['id','expected','confirmed']};
export async function identityRecoveryCommand(recovery,operation,data){
 if(!Object.hasOwn(parameters,operation)||!exact(data,['contextId',...parameters[operation]]))throw new AppError('INVALID');
 if(operation==='state')return recovery.state();
 if(operation==='backup')return recovery.backup(data.password,data.confirmation);
 if(operation==='inspect')return recovery.inspect(data.file,data.password);
 if(operation==='restore')return recovery.restore(data.file,data.password,data.expected,data.verified);
 if(data.confirmed!==true)throw new AppError('COLLABORATION_VERIFY');
 return recovery.activate(data.id,data.expected);
}
