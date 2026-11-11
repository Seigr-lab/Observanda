// Exact text formats for record fields: identifiers, addresses and digests are
// kept verbatim, character for character. A format only validates; it never
// trims, folds case or otherwise rewrites what the author entered.
const hex=length=>new RegExp('^[0-9A-Fa-f]{'+length+'}$');
const digests={'md5':32,'sha-1':40,'sha-256':64,'sha-384':96,'sha-512':128,'sha3-256':64,'sha3-512':128,'blake2b-512':128,'blake3':64};
const checks={
 // One line without surrounding spaces: serial numbers, tags, commit ids, DOIs.
 identifier:value=>value.length<=1000&&!/[\x00-\x1f\x7f]/.test(value)&&value===value.trim(),
 // An absolute address with a scheme: https:, git:, ssh:, urn:, doi:, file: ...
 uri:value=>value.length<=4000&&/^[A-Za-z][A-Za-z0-9+.-]*:[^\s\x00-\x1f\x7f]+$/.test(value),
 ...Object.fromEntries(Object.entries(digests).map(([id,length])=>[id,value=>hex(length).test(value)]))
};
export const TEXT_FIELD_FORMATS=Object.freeze(Object.keys(checks));
export const textFieldFormatDigest=format=>Object.hasOwn(digests,format);
export const validTextFieldFormat=format=>typeof format==='string'&&Object.hasOwn(checks,format);
export const textFieldValueValid=(format,value)=>typeof value==='string'&&validTextFieldFormat(format)&&checks[format](value);
// A digest has an exact length; other formats keep the general text limit.
export const textFieldFormatLength=format=>textFieldFormatDigest(format)?digests[format]:format==='uri'?4000:format==='identifier'?1000:10000;
