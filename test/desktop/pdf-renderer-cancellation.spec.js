import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfArchivalAvailable} from '../../src/pdf-archival.js';

test('cancelled rendering stays busy through real validator shutdown and removes its temporary input before reuse',async()=>{
 test.skip(!await pdfArchivalAvailable(),'Prepared offline PDF validation runtime required');
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-cancellation-')),entry=path.join(profile,'app.cjs'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  // A disposable main-process fixture exposes only the Node modules needed to
  // hold a real child close notification. The production renderer is unchanged.
  await writeFile(entry,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('crashDumps',${JSON.stringify(path.join(profile,'crashes'))});app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});globalThis.pdfService=import(${JSON.stringify(pathToFileURL(path.resolve('desktop/pdf-renderer.js')).href)});globalThis.pdfTestModules={childProcess:require('node:child_process'),syncBuiltinESMExports:require('node:module').syncBuiltinESMExports,fs:require('node:fs/promises'),path:require('node:path')};`);
  const header={version:1,id:randomUUID(),name:'Cancellation lifecycle',language:'en',direction:'ltr',layout:pdfLayoutPreset(),outputProfile:'pdfa-2u'},section={id:randomUUID(),title:'Retained evidence',content:'The next export waits for validator shutdown.',layout:null,start:null},input=await embedPdfFonts(await compilePdfDocument(header,[section]));
  app=await electron.launch({args:[entry],env});
  const result=await app.evaluate(async({app,BrowserWindow,session},input)=>{
   const {renderPdfDocument}=await globalThis.pdfService,{childProcess,syncBuiltinESMExports,fs,path}=globalThis.pdfTestModules,spawn=childProcess.spawn,controller=new AbortController(),isolated=session.fromPartition('observanda-pdf-renderer',{cache:false}),clearCache=isolated.clearCache.bind(isolated);
   let releaseClose,closed,cleaned;const closeReached=new Promise(resolve=>closed=resolve),cleanReached=new Promise(resolve=>cleaned=resolve);let settled=false,shown=0,temporary,spawnEnvironment,working;
   const names=['JaVa_ToOl_OpTiOnS','_jAvA_OpTiOnS','JdK_JaVa_OpTiOnS','ClAsSpAtH','JaVa_OpTs'],previous=names.map(name=>[name,process.env[name]]);
   for(const name of names)process.env[name]='invalid inherited Java option';
   app.on('browser-window-created',(_event,win)=>win.on('show',()=>shown++));
   isolated.clearCache=async()=>{await clearCache();cleaned();};
   childProcess.spawn=function(file,args,options){
    const child=spawn.call(this,file,args,options);
    if(args.includes('--flavour')){
     temporary=path.dirname(args.at(-1));spawnEnvironment=Object.keys(options.env).filter(key=>['JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','JDK_JAVA_OPTIONS','CLASSPATH','JAVA_OPTS'].includes(key.toUpperCase()));
     const emit=child.emit.bind(child);child.emit=function(event,...values){if(event==='close'){releaseClose=()=>emit(event,...values);closed();return true;}return emit(event,...values);};
     child.once('spawn',()=>controller.abort(new Error('Stop active validator')));
    }
    return child;
   };syncBuiltinESMExports();
   try{
    working=renderPdfDocument(input,{signal:controller.signal}).then(()=>({unexpected:true}),error=>({message:error.message})).finally(()=>{settled=true;});
    await closeReached;await cleanReached;await new Promise(resolve=>setImmediate(resolve));
    const settledBeforeClose=settled;let nextWhileClosing;try{await renderPdfDocument({...input,outputProfile:undefined});nextWhileClosing='admitted';}catch(error){nextWhileClosing=error.code;}
    const inputRetainedBeforeClose=(await fs.lstat(path.join(temporary,'document.pdf'))).isFile();releaseClose();releaseClose=null;const stopped=await working;
    let removed=false;try{await fs.lstat(temporary);}catch(error){removed=error.code==='ENOENT';}
    const next=await renderPdfDocument({...input,outputProfile:undefined});
    return {settledBeforeClose,nextWhileClosing,inputRetainedBeforeClose,stopped,removed,spawnEnvironment,shown,windows:BrowserWindow.getAllWindows().length,nextPdf:next.bytes?.subarray(0,5).toString()};
   }finally{
    releaseClose?.();controller.abort();await working?.catch(()=>{});childProcess.spawn=spawn;syncBuiltinESMExports();isolated.clearCache=clearCache;for(const [name,value] of previous){if(value===undefined)delete process.env[name];else process.env[name]=value;}
   }
  },input);
  expect(result.settledBeforeClose).toBe(false);expect(result.nextWhileClosing).toBe('PDF_BUSY');expect(result.inputRetainedBeforeClose).toBe(true);expect(result.stopped).toEqual({message:'Stop active validator'});expect(result.removed).toBe(true);expect(result.spawnEnvironment).toEqual([]);expect(result.shown).toBe(0);expect(result.windows).toBe(0);expect(result.nextPdf).toBe('%PDF-');
 }finally{await app?.close();if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-cancellation-'))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
