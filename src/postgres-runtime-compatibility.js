import path from 'node:path';
import {AppError} from './errors.js';

// The desktop bundle owns its current runtime path. An existing cluster owns
// its major version; relocating the application must never replace that cluster
// or silently switch to another database engine version.
export async function compatibleManagedRuntime(config,requestedBin,readVersion){
 const bin=requestedBin?path.resolve(requestedBin):config.bin;
 if(await readVersion(bin)!==config.major)throw new AppError('DATABASE_UPDATE');
 return bin;
}
