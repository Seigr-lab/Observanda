import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {dependencyInventory} from './release-inventory.js';

// Include build tools: Electron and its packager are not npm production deps.
// Unavailable or malformed advisory responses fail closed. A clean npm audit
// does not qualify the separately inventoried native binaries.
dependencyInventory(JSON.parse(await readFile('package-lock.json','utf8')));
const npm=process.env.npm_execpath;
if(!npm)throw Error('Run npm run check:dependencies.');
let output;
try{output=await promisify(execFile)(process.execPath,[npm,'audit','--json','--package-lock-only','--ignore-scripts'],{windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});}
catch(error){if(typeof error.stdout!=='string'||error.killed)throw Error('Dependency advisory service unavailable.');output=error;}
let report;try{report=JSON.parse(output.stdout);}catch{throw Error('Dependency advisory response is invalid.');}
const counts=report.metadata?.vulnerabilities;
if(report.error||!counts||!['info','low','moderate','high','critical','total'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0))throw Error('Dependency advisory response is incomplete.');
console.log('Dependency advisory counts: '+JSON.stringify(counts));
if(counts.total!==0)throw Error('Dependency advisories require remediation before packaging.');
