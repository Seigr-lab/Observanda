import {parentPort,workerData} from 'node:worker_threads';
import {inspectFont} from './font-inspector.js';
try{parentPort.postMessage({info:inspectFont(Buffer.from(workerData))});}catch{parentPort.postMessage({error:true});}
