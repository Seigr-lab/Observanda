import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfPageMasterDefaults} from '../../src/web/pdf-page-master-model.js';
import {pdfStructureDefaults} from '../../src/web/pdf-structure-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
const run=promisify(execFile),python=process.env.OBSERVANDA_PDF_PYTHON||'python';
const paragraph=(text,align='start')=>({type:'paragraph',attrs:{align},content:[{type:'text',text}]});
const section=(number,title)=>({id:randomUUID(),title,content:{type:'doc',content:[paragraph('P'+number+'-L'),paragraph('P'+number+'-R','end')]},layout:null,start:number===1?null:'page'});
const mm=value=>value*72/25.4;
// Optional independent PDF inspection, never a renderer or package installation.
// The caller may provide its normal Python/PYTHONPATH environment. Missing
// PyMuPDF is an explicit skip, not a CSS-only substitute for this test.
const inspect=String.raw`
import json, pathlib, sys, pymupdf
pdf=pymupdf.open(sys.argv[1])
result=[]
for number,page in enumerate(pdf):
    spans=[{'text':span['text'],'box':list(span['bbox'])} for block in page.get_text('dict')['blocks'] if 'lines' in block for line in block['lines'] for span in line['spans']]
    links=[{'kind':link['kind'],'page':link.get('page'),'to':list(link['to']) if 'to' in link else None,'from':list(link['from'])} for link in page.get_links()]
    markers={text:[list(rect) for rect in page.search_for(text)] for text in ['P'+str(number+1)+'-L','P'+str(number+1)+'-R','Retained endnote','HC v','HC VI','HC 7','HC viii','FC v/v','FC VI/V','FC 7/5','FC viii/v']}
    if len(sys.argv)>2:
        page.get_pixmap(dpi=96).save(str(pathlib.Path(sys.argv[2])/('page-'+str(number+1)+'.png')))
    result.append({'width':page.rect.width,'height':page.rect.height,'text':page.get_text(),'spans':spans,'links':links,'markers':markers})
print(json.dumps({'pages':result,'outline':pdf.get_toc()}))
`;

test('page masters print physical facing margins, first-page suppression and continuous styled numbers',async({},info)=>{
 let available=false;try{await run(python,['-c','import pymupdf'],{windowsHide:true});available=true;}catch{}
 test.skip(!available,'PDF output inspection requires Python with PyMuPDF; set OBSERVANDA_PDF_PYTHON if needed.');
 const profile=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-page-master-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try{
  const layout=pdfLayoutPreset();layout.margins={top:18,right:12,bottom:20,left:28};layout.pageMaster={...pdfPageMasterDefaults(layout),facingPages:true,gutterMm:9,firstPageHeader:false,firstPageFooter:false,numberStyle:'lower-roman',numberStart:4,header:{left:'HEADER {section}',center:'HC {page}',right:'RIGHT'},footer:{left:'FOOTER',center:'FC {page}/{pages}',right:'END'}};
  const header={version:1,id:randomUUID(),name:'Physical page master qualification',language:'en',direction:'ltr',layout};
  const sections=[section(1,'First'),section(2,'Second'),section(3,'Third'),section(4,'Fourth')];
  sections[0].notes=[{id:randomUUID(),block:2,kind:'endnote',content:'Retained endnote'}];
  sections[2].layout={...structuredClone(layout),widthMm:297,heightMm:210};sections[2].layout.pageMaster.numberStyle='upper-roman';
  sections[3].layout=structuredClone(layout);sections[3].layout.pageMaster.numberStyle='decimal';
  const input=await embedPdfFonts(await compilePdfDocument(header,sections));
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});
  const render=input=>app.evaluate(async({app,BrowserWindow},input)=>{
   await app.whenReady();const {renderPdfDocument}=await globalThis.pdfService,result=await renderPdfDocument(input);
   return {pdf:result.bytes?.toString('base64'),preflight:result.preflight,visible:BrowserWindow.getAllWindows().some(win=>win.isVisible()),windows:BrowserWindow.getAllWindows().length};
  },input);
  const rendered=await render(input);
  expect(rendered.preflight.status).not.toBe('fatal');expect(rendered.visible).toBe(false);expect(rendered.windows).toBe(0);expect(rendered.pdf).toBeTruthy();
  const file=info.outputPath('page-masters.pdf');await writeFile(file,Buffer.from(rendered.pdf,'base64'));
  const {stdout}=await run(python,['-c',inspect,file,path.dirname(file)],{windowsHide:true,maxBuffer:4*1024*1024}),inspection=JSON.parse(stdout),{pages}=inspection;
  await writeFile(info.outputPath('page-masters-inspection.json'),JSON.stringify(inspection,null,2)+'\n');
  expect(pages).toHaveLength(5);
  for(const [index,page] of pages.entries()){
   const landscape=index===2,width=landscape?297:210,height=landscape?210:297;
   expect(Math.abs(page.width-mm(width))).toBeLessThan(1);expect(Math.abs(page.height-mm(height))).toBeLessThan(1);
   if(index<4){
    const left=page.markers['P'+(index+1)+'-L'],right=page.markers['P'+(index+1)+'-R'];expect(left).toHaveLength(1);expect(right).toHaveLength(1);
    // Physical left/right page parity is independent of the authored start=4.
    expect(Math.abs(left[0][0]-mm(index%2===0?37:12))).toBeLessThan(1);
    expect(Math.abs(right[0][2]-mm(width-(index%2===0?12:37)))).toBeLessThan(1);
   }
  }
  expect(pages[0].text).not.toMatch(/HEADER|HC |RIGHT|FOOTER|FC |END/);
  for(const [index,number,total,title] of [[1,'v','v','Second'],[2,'VI','V','Third'],[3,'7','5','Fourth'],[4,'viii','v','']]){
   const page=pages[index];expect(page.text).toContain('HC '+number);expect(page.text).toContain('FC '+number+'/'+total);expect(page.text).toContain('HEADER'+(title?' '+title:''));expect(page.text).toContain('RIGHT');expect(page.text).toContain('FOOTER');expect(page.text).toContain('END');
   const top=page.markers['HC '+number],bottom=page.markers['FC '+number+'/'+total];expect(top).toHaveLength(1);expect(bottom).toHaveLength(1);
   expect(top[0][3]).toBeLessThan(mm(18));expect(bottom[0][1]).toBeGreaterThan(page.height-mm(20));
  }
  // Inspect real PDF destinations, including the backlink, across named pages.
  const note=pages[0].links.find(link=>link.page===4),back=pages[4].links.find(link=>link.page===0);
  expect(note).toBeTruthy();expect(back).toBeTruthy();for(const link of [note,back]){const target=pages[link.page];expect(link.to.every(Number.isFinite)).toBe(true);expect(link.to[0]).toBeGreaterThanOrEqual(0);expect(link.to[0]).toBeLessThan(target.width);expect(link.to[1]).toBeGreaterThanOrEqual(0);expect(link.to[1]).toBeLessThan(target.height);}expect(pages[4].text).toContain('Retained endnote');
  expect(inspection.outline.filter(row=>['First','Second','Third','Fourth'].includes(row[1])).map(row=>row.slice(1))).toEqual([['First',1],['Second',2],['Third',3],['Fourth',4]]);
  header.structure={...pdfStructureDefaults(),bookmarks:false};header.layout.pageMaster.firstPageHeader=true;header.layout.pageMaster.firstPageFooter=true;
  const disabled=await render(await embedPdfFonts(await compilePdfDocument(header,sections))),disabledFile=info.outputPath('page-masters-no-outline.pdf');await writeFile(disabledFile,Buffer.from(disabled.pdf,'base64'));
  const noOutline=JSON.parse((await run(python,['-c',inspect,disabledFile],{windowsHide:true,maxBuffer:4*1024*1024})).stdout);
  expect(noOutline.outline).toEqual([]);expect(noOutline.pages).toHaveLength(5);expect(noOutline.pages[0].text).toContain('HC iv');expect(noOutline.pages[0].text).toContain('FC iv/v');expect(noOutline.pages[0].links.some(link=>link.page===4)).toBe(true);expect(disabled.visible).toBe(false);expect(disabled.windows).toBe(0);
 }finally{await app?.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
