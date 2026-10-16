// Adapt a callback-owned resource to an iterator without extending its lifetime
// past completion, early return, cancellation or an exception in the consumer.
export async function* scopedIterator(open,create){
 let ready,failed,release;
 const opened=new Promise((resolve,reject)=>{ready=resolve;failed=reject;}),finished=new Promise(resolve=>{release=resolve;});
 const lifetime=Promise.resolve().then(()=>open(async resource=>{ready(create(resource));await finished;}));
 lifetime.catch(failed);
 try{yield* await opened;}finally{release();await lifetime;}
}
