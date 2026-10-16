import {randomUUID} from 'node:crypto';

// These reserved filenames can never be committed evidence or metadata paths.
// Only the final atomic replacement makes their bytes part of a workspace.
export const temporaryWriteName=()=>'.write-'+randomUUID()+'.tmp';
export const temporaryStreamName=()=>'.stream-'+randomUUID();
const uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const temporary=new RegExp('^(?:\\.write-'+uuid+'\\.tmp|\\.stream-'+uuid+'(?:\\.lock)?)$');
export const isStorageTemporary=name=>temporary.test(name);
