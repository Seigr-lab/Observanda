// Checksums an author can compute for a retained original and compare with a
// published value (release pages, SHA256SUMS files, archive catalogues).
// SHA-1 and MD5 remain available because older releases publish them; they
// identify a file but no longer prove it was not deliberately altered.
export const ARTIFACT_DIGESTS=Object.freeze({
 sha256:{hash:'sha256',hex:64,weak:false},
 sha384:{hash:'sha384',hex:96,weak:false},
 sha512:{hash:'sha512',hex:128,weak:false},
 'sha3-256':{hash:'sha3-256',hex:64,weak:false},
 'sha3-512':{hash:'sha3-512',hex:128,weak:false},
 blake2b512:{hash:'blake2b512',hex:128,weak:false},
 sha1:{hash:'sha1',hex:40,weak:true},
 md5:{hash:'md5',hex:32,weak:true}
});
export const artifactDigestNames=Object.keys(ARTIFACT_DIGESTS);
// Accept the value as published: surrounding spaces, upper-case hex, or a
// checksum-file line ("<hex>  name" / "<hex> *name"). The comparison itself is exact.
export function normalizedDigest(value){
 if(typeof value!=='string')return null;
 const first=value.trim().split(/\s+/)[0]??'';
 return /^[0-9a-f]+$/i.test(first)?first.toLowerCase():null;
}
export function validExpectedDigest(algorithm,value){
 const digest=normalizedDigest(value);return !!ARTIFACT_DIGESTS[algorithm]&&value.length<=4096&&digest!==null&&digest.length===ARTIFACT_DIGESTS[algorithm].hex;
}
export function validArtifactDigestCommand(command){
 if(!command||typeof command!=='object'||Array.isArray(command))return false;
 const keys=Object.keys(command);
 if(keys.some(key=>!['ref','algorithm','expected'].includes(key))||!keys.includes('ref')||!keys.includes('algorithm'))return false;
 if(!Object.hasOwn(ARTIFACT_DIGESTS,command.algorithm))return false;
 return command.expected===undefined||typeof command.expected==='string'&&validExpectedDigest(command.algorithm,command.expected);
}
