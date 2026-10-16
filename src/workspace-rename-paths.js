import path from 'node:path';
import {AppError} from './errors.js';
export function nestedRenameRoot(root,relative){
 if(typeof relative!=='string'||!relative||/[\\:\u0000]/.test(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw new AppError('STORAGE_RENAME_STATE');
 const target=path.resolve(root,...relative.split('/')),tail=path.relative(root,target);
 if(!tail||tail==='..'||tail.startsWith('..'+path.sep)||path.isAbsolute(tail)||relative==='.observanda')throw new AppError('STORAGE_RENAME_STATE');return target;
}
