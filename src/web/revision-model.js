// Canonical revision input shared by historical references and derivative checks.
export const canonicalValue=value=>Array.isArray(value)?value.map(canonicalValue):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])])):value;
export const revisionText=value=>JSON.stringify(canonicalValue(value));
export const revisionId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
