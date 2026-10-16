import {AppError} from './errors.js';
import {ENVELOPE,ENCRYPTION_OVERHEAD} from './encryption.js';

const format='observanda-preview-cursor',maximum=4096;
const invalid=()=>{throw new AppError('INVALID');};
const hasEnvelope=bytes=>Buffer.isBuffer(bytes)&&bytes.length>=ENCRYPTION_OVERHEAD&&bytes.subarray(0,ENVELOPE.length).equals(ENVELOPE);
function base64(value){
 if(typeof value!=='string'||!value||value.length>maximum||!/^[A-Za-z0-9_-]+$/.test(value))invalid();
 const bytes=Buffer.from(value,'base64url');if(bytes.toString('base64url')!==value)invalid();return bytes;
}

// Keep authenticated ciphertext inside a text envelope: publication privacy
// inspection must not interpret random encrypted bytes as pasted private text.
// Hex also keeps the inner value from resembling a credential token.
// Authentication and snapshot/query bindings remain the caller's responsibility.
export function encodeAppearanceCursor(bytes){
 if(!hasEnvelope(bytes)||bytes.length>maximum)invalid();
 const cursor=Buffer.from(JSON.stringify({format,value:bytes.toString('hex')})).toString('base64url');
 if(cursor.length>maximum)invalid();return cursor;
}
export function decodeAppearanceCursor(cursor){
 const bytes=base64(cursor);
 // Existing preview links use the same authenticated bytes without a wrapper.
 if(hasEnvelope(bytes))return bytes;
 const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))invalid();
 let envelope;try{envelope=JSON.parse(text);}catch{invalid();}
 if(envelope?.format!==format||Object.keys(envelope).join()!=='format,value'||typeof envelope.value!=='string')invalid();
 if(!/^(?:[0-9a-f]{2})+$/.test(envelope.value))invalid();
 const value=Buffer.from(envelope.value,'hex');
 if(!hasEnvelope(value)||encodeAppearanceCursor(value)!==cursor)invalid();
 return value;
}
