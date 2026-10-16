import {parentPort,workerData} from 'node:worker_threads';
import {parseCalendar} from './ical.js';
try{parentPort.postMessage({events:parseCalendar(workerData.text,workerData.range)});}catch(error){parentPort.postMessage({error:error.code??'CALENDAR_FORMAT'});}
