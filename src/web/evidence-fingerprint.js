// A bounded, cross-platform intake fingerprint. Originals also retain their
// ordinary SHA-256; this chunk identity only detects changed upload sources.
export const FILE_CHUNK=1024*1024;
export const validFingerprint=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const emptyFingerprintChain='0'.repeat(64);
export const fingerprintStep=(chain,index,chunk,hash)=>hash(chain+':'+index+':'+chunk.size+':'+chunk.sha256);
export async function fileFingerprint(size,chunks,hash){
 if(!Number.isSafeInteger(size)||size<0)throw Error('Incomplete file fingerprint.');
 let chain=emptyFingerprintChain,index=0;
 for await(const chunk of chunks){
  if(chunk.size!==Math.min(FILE_CHUNK,size-index*FILE_CHUNK)||chunk.size<=0||!validFingerprint(chunk.sha256))throw Error('Invalid file fingerprint.');
  chain=await fingerprintStep(chain,index++,chunk,hash);
 }
 if(index!==Math.ceil(size/FILE_CHUNK))throw Error('Incomplete file fingerprint.');
 return hash('Observanda/evidence-file/v1:'+size+':'+index+':'+chain);
}
const hex=buffer=>[...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
export const browserHash=async value=>hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value));
export async function* fingerprintChunks(file,{signal,progress=()=>{},count=Math.ceil(file.size/FILE_CHUNK)}={}){
 for(let index=0;index<count;index++){
  signal?.throwIfAborted();const bytes=await file.slice(index*FILE_CHUNK,(index+1)*FILE_CHUNK).arrayBuffer();
  yield {size:bytes.byteLength,sha256:await browserHash(bytes)};
  await progress(Math.min(file.size,(index+1)*FILE_CHUNK));
 }
 signal?.throwIfAborted();
}
export const fingerprintFile=(file,options)=>fileFingerprint(file.size,fingerprintChunks(file,options),browserHash);
export async function matchingUploadPrefix(file,session,options){
 if(file.size!==session.size||session.chunkSize!==FILE_CHUNK||!Number.isSafeInteger(session.receivedChunks)||session.receivedChunks<0||
  session.receivedChunks>Math.ceil(file.size/FILE_CHUNK)||session.receivedBytes!==Math.min(file.size,session.receivedChunks*FILE_CHUNK)||!validFingerprint(session.receivedChain))return false;
 let chain=emptyFingerprintChain,index=0;
 for await(const chunk of fingerprintChunks(file,{...options,count:session.receivedChunks}))chain=await fingerprintStep(chain,index++,chunk,browserHash);
 return chain===session.receivedChain;
}
