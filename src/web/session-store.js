// IndexedDB is origin scoped, including the port. It is never automatically
// transmitted to another loopback listener, unlike a host-scoped cookie.
const valid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
let opening;
function database(){
 return opening??=new Promise((resolve,reject)=>{
  const request=indexedDB.open('observanda-browser-session',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('session');
  request.onerror=()=>{opening=null;reject(request.error);};
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
 });
}
export async function browserSession(value){
 const write=value!==undefined;if(write&&!valid(value))throw Error('Invalid browser session.');
 const db=await database();
 return new Promise((resolve,reject)=>{
  const transaction=db.transaction('session',write?'readwrite':'readonly'),store=transaction.objectStore('session'),request=write?store.put(value,'current'):store.get('current');
  transaction.oncomplete=()=>resolve(write?value:valid(request.result)?request.result:null);
  transaction.onerror=transaction.onabort=()=>reject(transaction.error??Error('Browser session storage is unavailable.'));
 });
}

// The application's own requests carry the credential themselves. The session worker leaves
// them to the browser, so cancelling one of them also cancels it on the server.
export async function sessionCredential(){try{return await browserSession();}catch{return null;}}
export async function sessionHeaders(headers={}){const credential=await sessionCredential();return credential?{...headers,'X-Observanda-Session':credential}:{...headers};}
