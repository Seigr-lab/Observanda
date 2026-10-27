// Browsers retain a failed module fetch in their module map. Retrying the same
// import does not necessarily issue another request. A failed entry can retry
// through its bundled, same-origin source asset with a fresh entry identity.
// Dependencies still use their normal URLs: failure of a dependency remains an
// explicit load failure, never permission to evaluate unverified source text.
export function retryModule(load,source){
 if(!/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.js$/.test(source))throw TypeError('Invalid module entry');
 let failed=false,attempt=0;
 return async()=>{
  try{return await (failed?import(source+'?retry='+ ++attempt):load());}
  catch(error){failed=true;throw error;}
 };
}
