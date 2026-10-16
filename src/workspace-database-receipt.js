import path from 'node:path';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';

export const DATABASE_CONVERSION_FILE='.observanda/database-conversion.observanda';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export async function databaseConversionState(workspace){
 const file=path.join(workspace.root,DATABASE_CONVERSION_FILE),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>4096)throw new AppError('CATALOGUE_DAMAGED');
 let value;try{value=JSON.parse(await workspace.readFile(file,'utf8'));}catch{throw new AppError('CATALOGUE_DAMAGED');}
 if(value?.version!==1||!uuid(value.sourceId)||!uuid(value.targetId)||value.sourceId===value.targetId||!['prepared','active','complete'].includes(value.phase)||!/^[a-f0-9]{64}$/.test(value.archiveSha256??''))throw new AppError('CATALOGUE_DAMAGED');return value;
}
