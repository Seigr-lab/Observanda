// A separate JavaScript-disabled preview context has no origin store. Supply
// its test credential only to the matching application origin, never globally.
export async function authorizePreviewContext(page,context){
 const origin=new URL(page.url()).origin,session=await page.evaluate(async()=>{const {browserSession}=await import('/session-store.js');return browserSession();});
 if(!/^[a-f0-9]{64}$/.test(session))throw Error('Preview fixture has no browser authorization.');
 await context.route(origin+'/**',route=>route.continue({headers:{...route.request().headers(),'X-Observanda-Session':session}}));
}

// Playwright's APIRequestContext is a native HTTP client: it does not run the
// page's service worker. Supply the same origin-local header explicitly.
export async function sessionRequest(page,method,url,options={}){
 const target=new URL(url,page.url());
 if(target.pathname==='/api/session'){
  const response=await page.request[method](target.href,options);
  if(response.ok()){
   const {session}=await response.json();await page.goto(target.origin+'/');
   await page.evaluate(async session=>{const {authorizeBrowser}=await import('/browser-session.js');await authorizeBrowser(session);},session);
  }
  return response;
 }
 if(target.origin!==new URL(page.url()).origin)throw Error('Session fixture cannot forward credentials to another origin.');
 const session=await page.evaluate(async()=>{const {browserSession}=await import('/session-store.js');return browserSession();});
 return page.request[method](target.href,{...options,maxRedirects:0,headers:{...(session?{'X-Observanda-Session':session}:{}),...options.headers}});
}
