import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
const header=()=>({version:1,id:randomUUID(),name:'Layout qualification',language:'en',direction:'ltr',layout:pdfLayoutPreset()});
const section=(content,title='')=>({id:randomUUID(),title,content,layout:null,start:null});
test('PDF engine exports hidden, isolated pages with fonts, links and mixed physical sizes',async({},info)=>{
 const profile=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-render-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try{
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});
  const render=async input=>app.evaluate(async({app,BrowserWindow},input)=>{await app.whenReady();const {renderPdfDocument}=await globalThis.pdfService,result=await renderPdfDocument(input);return {pdf:result.bytes.toString('base64'),renderer:result.renderer,conformance:result.conformance,visible:BrowserWindow.getAllWindows().some(w=>w.isVisible())};},input);
  const h=header();h.layout.header='Retained observations';h.layout.footer='Reviewed edition';
  const linked={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Exact integer: 9007199254740993. ',marks:[]},{type:'text',text:'Reference',marks:[{type:'link',attrs:{href:'https://example.org/reference',title:'',target:'_self',nofollow:false}}]}]}]};
  const a=section(linked,'Results'),b=section('Landscape results on a deliberate page.','Wide measurements');b.layout={...pdfLayoutPreset(),widthMm:297,heightMm:210};b.start='page';
  const table=section({type:'doc',content:[{type:'book_table',attrs:{version:1,id:randomUUID(),title:'Sequential readings',headers:['Reading','Exact value'],rows:Array.from({length:120},(_,i)=>[String(i+1),'9007199254740993.'+String(i+1).padStart(3,'0')])}}]},'Long table');table.start='page';
  const result=await render(await embedPdfFonts(await compilePdfDocument(h,[a,b,table]))),bytes=Buffer.from(result.pdf,'base64');
  expect(result.visible).toBe(false);expect(result.conformance).toEqual([]);expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(result.renderer.chromium).toBeTruthy();expect(bytes.includes(Buffer.from('https://example.org/reference'))).toBe(true);
  expect((bytes.toString('latin1').match(/\/Type \/Page\b/g)??[]).length).toBeGreaterThanOrEqual(5);
  await writeFile(info.outputPath('document-digital.pdf'),bytes);
  h.layout.links='disabled';const printed=Buffer.from((await render(await embedPdfFonts(await compilePdfDocument(h,[a])))).pdf,'base64');expect(/\/Subtype \/Link|https:\/\/example\.org/.test(printed.toString('latin1'))).toBe(false);await writeFile(info.outputPath('document-print.pdf'),printed);
  const arabic=header();arabic.direction='rtl';arabic.language='ar';arabic.layout.font='aref-ruqaa-ink';const rtl=await render(await embedPdfFonts(await compilePdfDocument(arabic,[section('\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645')])));await writeFile(info.outputPath('document-arabic.pdf'),Buffer.from(rtl.pdf,'base64'));
  const guarded=await app.evaluate(async({BrowserWindow})=>{const {renderPdfDocument}=await globalThis.pdfService;const result=await renderPdfDocument({version:1,html:'<!doctype html><script>window.location="https://example.org"</script><img src="https://example.org/x"><p>Blocked external requests</p>'});return {bytes:result.bytes,preflight:result.preflight,windows:BrowserWindow.getAllWindows().length};});expect(guarded.bytes).toBeNull();expect(guarded.preflight.findings.some(item=>item.code==='PDF_IMAGE_MISSING')).toBe(true);expect(guarded.windows).toBe(0);
  const inFlight=await app.evaluate(async({BrowserWindow})=>{
   const {renderPdfDocument}=await globalThis.pdfService,c=new AbortController(),first=renderPdfDocument({version:1,html:'<p>Cancelled work</p>'},{signal:c.signal});
   let busy;try{await renderPdfDocument({version:1,html:'<p>Second</p>'});}catch(e){busy=e.code;}c.abort();let error;try{await first;}catch(e){error=e.name;}return {busy,error,windows:BrowserWindow.getAllWindows().length};
  });expect(inFlight).toEqual({busy:'PDF_BUSY',error:'AbortError',windows:0});
  const cancelled=await app.evaluate(async()=>{const {renderPdfDocument}=await globalThis.pdfService,c=new AbortController();c.abort();try{await renderPdfDocument({version:1,html:'<p>Cancelled</p>'},{signal:c.signal});}catch(e){return e.name;}});expect(cancelled).toBe('AbortError');
 }finally{await app?.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
