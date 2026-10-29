import {withScratch} from './scratch-work.js';
import {AsyncLocalStorage} from 'node:async_hooks';
// Keep the encrypted temporary store alive for exactly one async iteration,
// including early preview return, cancellation and reader exceptions.
export async function* scratchIterator(create,options={}){
 let ready,failed,release;
 const opened=new Promise((resolve,reject)=>{ready=resolve;failed=reject;}),finished=new Promise(resolve=>{release=resolve;});
 const lifetime=withScratch(async work=>{
  const iterator=create(work)[Symbol.asyncIterator](),run=AsyncLocalStorage.snapshot();
  // Iteration resumes in the consumer's context. Lazy scratch allocation must
  // retain the connection owner established here, including return/throw.
  ready({[Symbol.asyncIterator](){return this;},next:value=>run(()=>iterator.next(value)),return:value=>run(()=>iterator.return(value)),throw:error=>run(()=>iterator.throw(error))});
  await finished;
 },options);
 lifetime.catch(failed);
 try{yield* await opened;}finally{release();await lifetime;}
}
