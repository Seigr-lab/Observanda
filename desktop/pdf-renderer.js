// The document owner supplies authorized, compiled, self-contained content.
// This service renders in memory and never visits a website or app session.
import {app,BrowserWindow,session} from 'electron';
import {createHash} from 'node:crypto';
const fail=code=>Object.assign(new Error(code),{code});
let active=false,partition;
export async function renderPdfDocument(input,options={}){
 options.signal?.throwIfAborted();if(active)throw fail('PDF_BUSY');active=true;
 try{await app.whenReady();return await render(input,options);}finally{active=false;}
}
async function render(input,{signal,timeoutMs=120000,maxOutputBytes=64*1024*1024}={}){
 signal?.throwIfAborted();
 if(input?.version!==1||typeof input.html!=='string'||Buffer.byteLength(input.html)>64*1024*1024||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isSafeInteger(maxOutputBytes)||maxOutputBytes<1||maxOutputBytes>64*1024*1024)throw fail('PDF_INPUT');
 const isolated=partition??=session.fromPartition('observanda-pdf-renderer',{cache:false}),documentURL='https://document.invalid/';
 let win,timer,abort,registered=false;const denyDownload=event=>event.preventDefault();
 try{
  isolated.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  isolated.setPermissionCheckHandler(()=>false);
  await isolated.protocol.handle('https',request=>request.url===documentURL?new Response(input.html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'"}}):new Response('',{status:404}));registered=true;
  isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.url!==documentURL&&!details.url.startsWith('data:')}));
  isolated.on('will-download',denyDownload);
  signal?.throwIfAborted();
  win=new BrowserWindow({show:false,focusable:false,width:1000,height:1000,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:true,webSecurity:true,allowRunningInsecureContent:false,plugins:false,spellcheck:false,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-redirect',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  const cancelled=new Promise((_,reject)=>{abort=()=>{reject(signal?.reason??fail('PDF_CANCELLED'));if(!win.isDestroyed())win.destroy();};signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{reject(fail('PDF_TIMEOUT'));if(!win.isDestroyed())win.destroy();},timeoutMs);});
  const operation=(async()=>{
   await win.loadURL(documentURL);
   await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
   signal?.throwIfAborted();
   const bytes=await win.webContents.printToPDF({printBackground:true,displayHeaderFooter:false,preferCSSPageSize:true,generateTaggedPDF:true,generateDocumentOutline:true,scale:1});
   if(bytes.length>maxOutputBytes)throw fail('PDF_CAPACITY');
   if(bytes.subarray(0,5).toString()!=='%PDF-')throw fail('PDF_OUTPUT');
   return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:process.versions.electron,chromium:process.versions.chrome,recipeVersion:input.version},conformance:[]};
  })();
  return await Promise.race([operation,cancelled]);
 }finally{
  clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);
  if(win&&!win.isDestroyed())win.destroy();
  if(registered)isolated.protocol.unhandle('https');isolated.removeListener('will-download',denyDownload);
  await isolated.closeAllConnections();await isolated.clearStorageData();await isolated.clearCache();
 }
}
