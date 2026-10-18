import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {validPdfPreflight,PDF_PREFLIGHT_LIMIT} from '../../src/pdf-preflight.js';

async function hidden(operation){
 const profile=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-preflight-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});return await operation(app);}
 finally{await app?.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
const page=(id,body,extra='')=>'<!doctype html><style>html,body{margin:0}*{box-sizing:border-box}@page{size:100mm 120mm;margin:10mm}.pdf-section{font:12px sans-serif}p{margin:0 0 4px}img{max-width:100%;height:auto}</style><section class="pdf-section" id="pdf-section-'+id+'" data-pdf-width-mm="80" data-pdf-height-mm="100" '+extra+'>'+body+'</section>';
const render=async(app,input)=>app.evaluate(async({BrowserWindow},input)=>{const {renderPdfDocument}=await globalThis.pdfService,result=await renderPdfDocument(input);return {...result,bytes:result.bytes?.subarray(0,5).toString()??null,windows:BrowserWindow.getAllWindows().length};},input);

test('preflight measures print overflow, clipping, raster resolution and internal destinations with block identities',async()=>hidden(async app=>{
 const id=randomUUID(),pixel=await app.evaluate(({nativeImage})=>nativeImage.createFromBitmap(Buffer.from([0,0,255,255]),{width:1,height:1}).toDataURL());
 const input={version:1,html:page(id,'<p data-pdf-block-id="wide" style="width:150mm">Wide block</p><p data-pdf-block-id="clipped" style="height:5px;overflow:hidden">Clipped text<br>Second line</p><figure data-pdf-block-id="raster"><img src="'+pixel+'" style="width:30mm;height:30mm"></figure><p data-pdf-block-id="links"><a href="#absent">Missing destination</a> <a href="#present">Working destination</a> <a href="#hidden">Hidden destination</a></p><p id="present">Retained target</p><p id="hidden" style="display:none">Unprinted target</p><figure data-pdf-block-id="tall" style="height:110mm">Atomic content</figure>')};
 const result=await render(app,input);expect(validPdfPreflight(result.preflight)).toBe(true);expect(result.bytes).toBe('%PDF-');expect(result.preflight.status).toBe('warning');expect(result.windows).toBe(0);
 for(const [code,blockId] of [['PDF_CONTENT_OVERFLOW','wide'],['PDF_CONTENT_CLIPPED','clipped'],['PDF_IMAGE_RESOLUTION','raster'],['PDF_ANCHOR_MISSING','links'],['PDF_BLOCK_TOO_TALL','tall']])expect(result.preflight.findings).toContainEqual(expect.objectContaining({code,severity:'warning',sectionId:id,blockId,blockIndex:expect.any(Number)}));
 expect(result.preflight.findings.find(row=>row.code==='PDF_IMAGE_RESOLUTION').details.dpi).toBeLessThan(3);expect(result.preflight.findings.filter(row=>row.code.startsWith('PDF_ANCHOR_')).map(row=>row.details.target)).toEqual(['absent','hidden']);
 const only=await render(app,{...input,preflightOnly:true});expect(only.bytes).toBeNull();expect(only.sha256).toBeNull();expect(only.preflight).toEqual(result.preflight);expect(only.windows).toBe(0);
}));

test('preflight explicitly refuses missing image and invalid or hidden printable sections, with bounded findings',async()=>hidden(async app=>{
 const id=randomUUID(),html=page(id,'<figure data-pdf-block-id="missing"><img src="data:image/png;base64,broken"></figure>');
 const result=await render(app,{version:1,html});expect(result.bytes).toBeNull();expect(result.preflight.status).toBe('fatal');expect(result.preflight.findings).toContainEqual(expect.objectContaining({code:'PDF_IMAGE_MISSING',severity:'fatal',sectionId:id,blockId:'missing'}));expect(result.windows).toBe(0);
 const geometry=await render(app,{version:1,html:page(id,'<p>Unprintable</p>').replace('data-pdf-width-mm="80"','data-pdf-width-mm="0"')});expect(geometry.bytes).toBeNull();expect(geometry.preflight.findings[0].code).toBe('PDF_PAGE_GEOMETRY');
 const concealed=await render(app,{version:1,html:page(id,'<p>Hidden document</p>','style="display:none"')});expect(concealed.bytes).toBeNull();expect(concealed.preflight.findings[0].code).toBe('PDF_SECTION_HIDDEN');
 const many=await render(app,{version:1,preflightOnly:true,html:page(id,Array.from({length:PDF_PREFLIGHT_LIMIT+10},(_,i)=>'<p><a href="#missing-'+i+'">Missing</a></p>').join(''))});expect(many.preflight.findings).toHaveLength(PDF_PREFLIGHT_LIMIT);expect(many.preflight.truncated).toBe(true);expect(validPdfPreflight(many.preflight)).toBe(true);
}));

test('normal compiled pagination and bridge preflight preserve real PDF output and fatal findings',async()=>hidden(async app=>{
 const layout=pdfLayoutPreset(),header={version:1,id:randomUUID(),name:'Print qualification',language:'en',direction:'ltr',layout},section=(content,extra={})=>({id:randomUUID(),title:'Results',content,layout:null,start:null,...extra});
 const table={type:'doc',content:[{type:'book_table',attrs:{version:1,id:randomUUID(),title:'Readings',headers:['Row','Value'],rows:Array.from({length:80},(_,i)=>[String(i+1),'0.125'])}}]};
 const input=await embedPdfFonts(await compilePdfDocument(header,[section(table),section('A result with room to wrap in each printed column. '.repeat(300),{layout:{...layout,widthMm:297,heightMm:210,columns:2},start:'page'})]));
 const normal=await render(app,input);expect(normal.bytes).toBe('%PDF-');expect(normal.preflight).toEqual({version:1,status:'ok',findings:[],truncated:false});expect(normal.windows).toBe(0);
 const result=await app.evaluate(async(_electron,input)=>{
  const [{attachPdfService},{pdfRenderBridge},{EventEmitter}]=await globalThis.pdfBridgeModules,service=new EventEmitter(),host=new EventEmitter();service.connected=host.connected=true;
  service.send=value=>queueMicrotask(()=>host.emit('message',JSON.parse(JSON.stringify(value))));host.send=value=>queueMicrotask(()=>service.emit('message',JSON.parse(JSON.stringify(value))));
  const detach=attachPdfService(host),bridge=pdfRenderBridge(service);
  try{
   const good=await bridge.render({...input,preflightOnly:true}),fatal=await bridge.render({version:1,html:'<img src="data:image/png;base64,broken">'});
   detach();host.send=null;service.send=value=>queueMicrotask(()=>service.emit('message',{type:'pdf-result',id:value.id,bytes:null,sha256:null,preflight:{version:1,status:'ok',findings:[],truncated:false}}));
   let invalid;try{await bridge.render(input);}catch(error){invalid=error.code;}
   return {good:{bytes:good.bytes,preflight:good.preflight},fatal:{bytes:fatal.bytes,preflight:fatal.preflight},invalid};
  }finally{bridge.close();detach();}
 },input);
 expect(result.good.bytes).toBeNull();expect(result.good.preflight.status).toBe('ok');expect(result.fatal.bytes).toBeNull();expect(result.fatal.preflight.findings[0].code).toBe('PDF_IMAGE_MISSING');expect(result.invalid).toBe('PDF_OUTPUT');
}));
