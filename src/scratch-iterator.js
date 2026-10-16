import {withScratch} from './scratch-work.js';
// Keep the encrypted temporary store alive for exactly one async iteration,
// including early preview return, cancellation and reader exceptions.
export async function* scratchIterator(create,options={}){
 let ready,failed,release;
 const opened=new Promise((resolve,reject)=>{ready=resolve;failed=reject;}),finished=new Promise(resolve=>{release=resolve;});
 const lifetime=withScratch(async work=>{ready(create(work));await finished;},options);
 lifetime.catch(failed);
 try{yield* await opened;}finally{release();await lifetime;}
}
