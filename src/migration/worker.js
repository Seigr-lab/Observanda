import {inventorySource} from './inventory.js';
import {safeError} from '../errors.js';
let input='',last=0;
for await(const chunk of process.stdin){input+=chunk;if(input.length>8192)process.exit(1);}
const send=value=>new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve()));
try{
 const started=performance.now();
 const result=await inventorySource(JSON.parse(input),{onProgress:async value=>{const now=Date.now();if(now-last>200||value.phase==='verifying'){last=now;await send({progress:value});}}});
 await send({result});
 // Measure after serializing and flushing the report, so delivery memory is included.
 await send({inspection:{durationMs:Math.round(performance.now()-started),peakMemoryBytes:process.resourceUsage().maxRSS*1024}});
}catch(error){await send({error:safeError(error)});process.exitCode=1;}
