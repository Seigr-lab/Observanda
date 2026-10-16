import {digest} from '../storage-format.js';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const moduleCommandFingerprint=command=>digest(JSON.stringify(canonical(command)));
