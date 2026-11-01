import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Font decoding is synchronous, but ordinary application startup needs no font
// decoder. Node retains the loaded module after the first actual inspection.
export function createFont(bytes){return require('fontkit').create(bytes);}
