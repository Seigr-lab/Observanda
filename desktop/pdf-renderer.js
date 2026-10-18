// The document owner supplies authorized, compiled, self-contained content.
// This service renders in memory and never visits a website or app session.
import {app,BrowserWindow,session} from 'electron';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
// Recipe version tracks layout/finalization semantics independently of IPC.
const PDF_RECIPE_VERSION=2;
const fail=code=>Object.assign(new Error(code),{code});
let active=false,partition,preflightModule,resolutionModule,referencesModule,footnoteModule,pressModule,archivalModule,accessibilityModule;
const preflight=()=>preflightModule??=import(app.isPackaged?pathToFileURL(path.join(process.resourcesPath,'service','src','pdf-preflight.js')).href:new URL('../src/pdf-preflight.js',import.meta.url).href);
const resolution=()=>resolutionModule??=import(app.isPackaged?pathToFileURL(path.join(process.resourcesPath,'service','src','pdf-image-resolution.js')).href:new URL('../src/pdf-image-resolution.js',import.meta.url).href);
const references=()=>referencesModule??=import(app.isPackaged?pathToFileURL(path.join(process.resourcesPath,'service','src','pdf-page-references.js')).href:new URL('../src/pdf-page-references.js',import.meta.url).href);
const footnotes=()=>footnoteModule??=import(app.isPackaged?pathToFileURL(path.join(process.resourcesPath,'service','src','pdf-footnote-flow.js')).href:new URL('../src/pdf-footnote-flow.js',import.meta.url).href);
const pressGeometry=()=>pressModule??=import(app.isPackaged?pathToFileURL(path.join(process.resourcesPath,'service','src','pdf-press-geometry.js')).href:new URL('../src/pdf-press-geometry.js',import.meta.url).href);
const archival=()=>archivalModule??=import(app.isPackaged?pathToFileURL(path.join(process.resourcesPath,'service','src','pdf-archival.js')).href:new URL('../src/pdf-archival.js',import.meta.url).href);
const accessibility=()=>accessibilityModule??=import(app.isPackaged?pathToFileURL(path.join(process.resourcesPath,'service','src','pdf-accessibility-output.js')).href:new URL('../src/pdf-accessibility-output.js',import.meta.url).href);
const validationRuntime=()=>({directory:app.isPackaged?path.join(process.resourcesPath,'pdf-validation'):fileURLToPath(new URL('../.local/pdf-validation/',import.meta.url))});
export async function pdfOutputCapabilities(){const {pdfArchivalAvailable}=await archival();return {archival:await pdfArchivalAvailable({runtime:validationRuntime()})};}
export async function renderPdfDocument(input,options={}){
 options.signal?.throwIfAborted();if(active)throw fail('PDF_BUSY');active=true;
 try{await app.whenReady();return await render(input,options);}finally{active=false;}
}
async function render(input,{signal:externalSignal,timeoutMs=120000,maxOutputBytes=64*1024*1024}={}){
 const controller=new AbortController(),signal=externalSignal?AbortSignal.any([externalSignal,controller.signal]):controller.signal;
 signal.throwIfAborted();
 if(input?.version!==1||(input.outputProfile!==undefined&&!['pdfa-2u','pdfua-1'].includes(input.outputProfile))||(input.bookmarks!==undefined&&typeof input.bookmarks!=='boolean')||(input.preflightOnly!==undefined&&typeof input.preflightOnly!=='boolean')||typeof input.html!=='string'||Buffer.byteLength(input.html)>64*1024*1024||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isSafeInteger(maxOutputBytes)||maxOutputBytes<1||maxOutputBytes>64*1024*1024)throw fail('PDF_INPUT');
 const referenceTools=await references(),pageReferences=input.pageReferences??[];if(!referenceTools.validPdfPageReferences(pageReferences))throw fail('PDF_INPUT');
 const footnoteTools=input.footnoteFlow===undefined?null:await footnotes();if(footnoteTools&&!footnoteTools.validPdfFootnoteFlow(input.footnoteFlow))throw fail('PDF_INPUT');
 const isolated=partition??=session.fromPartition('observanda-pdf-renderer',{cache:false}),documentURL='https://document.invalid/';
 let win,timer,abort,operation,registered=false;const denyDownload=event=>event.preventDefault();
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
  const cancelled=new Promise((_,reject)=>{abort=()=>{reject(signal?.reason??fail('PDF_CANCELLED'));if(!win.isDestroyed())win.destroy();};signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>controller.abort(fail('PDF_TIMEOUT')),timeoutMs);});
  operation=(async()=>{
   await win.loadURL(documentURL);
   win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:'print'});
   const {pdfImageResolutionScript}=await resolution();try{await win.webContents.executeJavaScript(pdfImageResolutionScript);}catch{signal.throwIfAborted();throw fail('PDF_IMAGE_RESOLUTION_FAILED');}
   let footnoteResult=null;
   if(footnoteTools){try{footnoteResult=await win.webContents.executeJavaScript(footnoteTools.pdfFootnoteFlowScript(input.footnoteFlow));}catch(error){signal.throwIfAborted();throw fail(['PDF_FOOTNOTE_LAYOUT','PDF_CAPACITY'].find(code=>error?.message?.includes(code))??'PDF_FOOTNOTE_OVERFLOW');}}
   const {pdfPreflightScript,validPdfPreflight}=await preflight();let findings=footnoteResult?.preflight??await win.webContents.executeJavaScript(pdfPreflightScript);
   if(!validPdfPreflight(findings))throw fail('PDF_OUTPUT');
   signal?.throwIfAborted();
   const renderer={engine:'chromium',electron:process.versions.electron,chromium:process.versions.chrome,recipeVersion:PDF_RECIPE_VERSION};
   const output=()=>({bytes:null,sha256:null,renderer,conformance:[],preflight:findings});
   if(findings.status==='fatal')return output();
   const print=async outline=>{signal.throwIfAborted();const bytes=await win.webContents.printToPDF({printBackground:true,displayHeaderFooter:false,preferCSSPageSize:true,generateTaggedPDF:true,generateDocumentOutline:outline,scale:1});signal.throwIfAborted();if(bytes.length>maxOutputBytes)throw fail('PDF_CAPACITY');if(bytes.subarray(0,5).toString()!=='%PDF-')throw fail('PDF_OUTPUT');return bytes;};
   if(pageReferences.length){
    try{
     await win.webContents.executeJavaScript(referenceTools.pdfPageReferenceMeasurementScript(pageReferences));
     const measured=await referenceTools.extractPdfPageReferences(await print(false),pageReferences,{signal,maxBytes:maxOutputBytes});
     signal.throwIfAborted();await win.webContents.executeJavaScript(referenceTools.pdfPageReferenceApplyScript(pageReferences,measured));
     findings=await win.webContents.executeJavaScript(pdfPreflightScript);if(!validPdfPreflight(findings))throw fail('PDF_OUTPUT');
    }catch(error){signal.throwIfAborted();throw ['PDF_CAPACITY','PDF_OUTPUT'].includes(error?.code)?error:fail('PDF_PAGE_REFERENCES');}
   }
   if(input.preflightOnly||findings.status==='fatal')return output();
   let bytes=await print(input.bookmarks??true);
   if(input.outputProfile==='pdfua-1'){const {applyPdfAccessibilityOutput}=await accessibility();bytes=await applyPdfAccessibilityOutput(bytes,{accessibilityLayout:input.accessibilityLayout,identifyPdfUa:true,signal,maxBytes:maxOutputBytes});signal.throwIfAborted();}
   if(input.press!==undefined){const {applyPdfPressGeometry}=await pressGeometry();bytes=await applyPdfPressGeometry(bytes,input.press,{signal,maxBytes:maxOutputBytes});signal.throwIfAborted();}
   let validation;
   if(input.outputProfile==='pdfa-2u'){const {applyPdfArchival}=await archival(),result=await applyPdfArchival(bytes,{runtime:validationRuntime(),signal,maxBytes:maxOutputBytes});bytes=result.bytes;validation=result.validation;signal.throwIfAborted();}
   if(input.outputProfile==='pdfua-1'){const {validatePdfAccessibilityOutput}=await accessibility(),report=await validatePdfAccessibilityOutput(bytes,{runtime:validationRuntime(),signal,maxBytes:maxOutputBytes});if(!report.compliant)throw fail('PDF_ACCESSIBILITY_FAILED');const {version,profile,sha256,validator,validatorVersion,validatorSha256,passedRules,passedChecks}=report;validation={version,profile,sha256,validator,validatorVersion,validatorSha256,passedRules,passedChecks,automatedOnly:true};signal.throwIfAborted();}
   return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),renderer,conformance:validation?.profile==='pdfa-2u'?['pdfa-2u']:[],preflight:findings,...(validation?{validation}:{})};
  })();
  return await Promise.race([operation,cancelled]);
 }finally{
  clearTimeout(timer);controller.abort();if(abort)signal?.removeEventListener('abort',abort);
  if(win&&!win.isDestroyed())win.destroy();
  if(registered)isolated.protocol.unhandle('https');isolated.removeListener('will-download',denyDownload);
  try{await isolated.closeAllConnections();await isolated.clearStorageData();await isolated.clearCache();}
  finally{
   // Cancellation wins the result race, but the owner remains busy until the
   // worker/validator has exited and its temporary input has been removed.
   await operation?.catch(()=>{});
  }
 }
}
