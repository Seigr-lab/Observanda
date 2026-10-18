import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFHexString,decodePDFRawStream,StandardFonts} from '@cantoo/pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {applyPdfAccessibilityOutput,validPdfAccessibilityLayout,pdfAccessibilityReport,validatePdfAccessibilityOutput} from '../src/pdf-accessibility-output.js';
import {PDF_VALIDATOR_VERSION} from '../src/pdf-validation-dependencies.js';
const name=PDFName.of,layout={version:1,layouts:[{widthMm:200*25.4/72,heightMm:200*25.4/72,margins:{top:10,right:10,bottom:10,left:10},runningText:['{page}'],numberStyle:'decimal',numberStart:1}]};
async function fixture({unknown=false,tricky=false}={}){
 const pdf=await PDFDocument.create(),page=pdf.addPage([200,200]),font=await pdf.embedFont(StandardFonts.Helvetica),c=pdf.context;
 pdf.setTitle('Authored & \u00c5 title');pdf.setLanguage('en-GB');page.node.set(name('Resources'),c.obj({Font:{F1:font.ref}}));page.node.set(name('StructParents'),c.obj(0));
 const root=c.obj({Type:'StructTreeRoot'}),rootRef=c.register(root),document=c.obj({Type:'StructElem',S:'Document',P:rootRef,Lang:PDFHexString.fromText('en-GB')}),docRef=c.register(document),paragraph=c.obj({Type:'StructElem',S:'P',P:docRef,Pg:page.ref,K:0}),pRef=c.register(paragraph);
 const annotation=c.obj({Type:'Annot',Subtype:'Link',F:4,Rect:[20,120,100,135],A:{Type:'Action',S:'URI',URI:PDFHexString.fromText('https://example.org/study')},StructParent:1}),annotRef=c.register(annotation);
 const link=c.obj({Type:'StructElem',S:'Link',P:docRef,Pg:page.ref,K:[1,{Type:'OBJR',Obj:annotRef,Pg:page.ref}]}),linkRef=c.register(link);
 const outer=c.obj({Type:'StructElem',S:'Figure',P:docRef}),outerRef=c.register(outer),figure=c.obj({Type:'StructElem',S:'Figure',P:outerRef,Pg:page.ref,Alt:PDFHexString.fromText('Authored figure alternative'),K:2}),figureRef=c.register(figure);outer.set(name('K'),c.obj([figureRef]));
 document.set(name('K'),c.obj([pRef,linkRef,outerRef]));root.set(name('K'),docRef);root.set(name('ParentTree'),c.register(c.obj({Nums:[0,[pRef,linkRef,figureRef],1,linkRef]})));pdf.catalog.set(name('StructTreeRoot'),rootRef);pdf.catalog.set(name('MarkInfo'),c.obj({Marked:true}));page.node.set(name('Annots'),c.obj([annotRef]));
 const stream='/P <</MCID 0>> BDC\nBT /F1 12 Tf 20 160 Td (Body content) Tj ET\nEMC\n/Link <</MCID 1>> BDC\nBT /F1 12 Tf 20 120 Td (Exact link) Tj ET\nEMC\n/Figure <</MCID 2>> BDC\n20 60 20 20 re f\nEMC\n'+(tricky?'% BT ET BDC are not operators in this comment\n/Artifact <</Explanation (BT \\( ET)>> BDC\nEMC\n':'')+'BT /F1 9 Tf 170 12 Td (1) Tj ET\n'+(unknown?'BT /F1 12 Tf 20 95 Td (Unknown authored text) Tj ET\n':'');
 page.node.set(name('Contents'),c.register(c.flateStream(stream)));const bytes=Buffer.from(await pdf.save({useObjectStreams:false}));return {bytes,annot:annotRef,outer:outerRef,figure:figureRef};
}
function streamText(pdf){const value=pdf.getPage(0).node.Contents(),rows=value.asArray?.()??[value];return rows.map(value=>Buffer.from(decodePDFRawStream(pdf.context.lookup(value)).decode()).toString()).join('\n');}
const metadata=pdf=>Buffer.from(pdf.context.lookup(pdf.catalog.get(name('Metadata'))).contents).toString('utf8');
async function text(bytes){const loading=getDocument({data:Uint8Array.from(bytes),useSystemFonts:false,isEvalSupported:false,disableFontFace:true});try{const pdf=await loading.promise;return (await (await pdf.getPage(1)).getTextContent()).items.map(row=>row.str).join(' ');}finally{await loading.destroy();}}

test('incremental semantic repairs preserve exact text and authored alternatives without claiming PDF/UA',async()=>{
 const source=await fixture({tricky:true}),bytes=await applyPdfAccessibilityOutput(source.bytes,{accessibilityLayout:layout}),pdf=await PDFDocument.load(bytes,{updateMetadata:false});
 assert.ok(bytes.subarray(0,source.bytes.length).equals(source.bytes));assert.equal(await text(bytes),await text(source.bytes));assert.equal(pdf.context.lookup(source.annot).get(name('Contents')).decodeText(),'Exact link');assert.equal(String(pdf.context.lookup(source.outer).get(name('S'))),'/Div');assert.equal(pdf.context.lookup(source.figure).get(name('Alt')).decodeText(),'Authored figure alternative');assert.equal(pdf.catalog.getOrCreateViewerPreferences().getDisplayDocTitle(),true);
 assert.match(metadata(pdf),/Authored &amp; \u00c5 title/);assert.match(metadata(pdf),/en-GB/);assert.doesNotMatch(metadata(pdf),/pdfuaid/);assert.match(streamText(pdf),/\/Artifact <<\/Type \/Pagination>> BDC\nBT \/F1 9/);
 const candidate=await applyPdfAccessibilityOutput(bytes,{accessibilityLayout:layout,identifyPdfUa:true}),identified=await PDFDocument.load(candidate,{updateMetadata:false});assert.ok(candidate.subarray(0,bytes.length).equals(bytes));assert.match(metadata(identified),/pdfuaid:part="1"/);assert.match(metadata(identified),/Authored &amp; \u00c5 title/);
});

test('unknown unmarked text and ambiguous same-size printable areas are preserved for validation',async()=>{
 for(const config of [{unknown:true,layout},{unknown:false,layout:{version:1,layouts:[...layout.layouts,{...layout.layouts[0],margins:{top:1,right:1,bottom:1,left:1}}]}},{unknown:false,layout:{version:1,layouts:[{...layout.layouts[0],runningText:['Different running label']}]}}]){
  const source=await fixture({unknown:config.unknown}),before=await PDFDocument.load(source.bytes,{updateMetadata:false}),bytes=await applyPdfAccessibilityOutput(source.bytes,{accessibilityLayout:config.layout}),after=await PDFDocument.load(bytes,{updateMetadata:false});assert.equal(streamText(after),streamText(before));assert.equal(await text(bytes),await text(source.bytes));
 }
});

function report(compliant=true){return {report:{buildInformation:{releaseDetails:['core','validation-model','apps'].map(id=>({id,version:PDF_VALIDATOR_VERSION}))},jobs:[{itemDetails:{size:100,name:'private local path must not escape'},validationResult:[{jobEndStatus:'normal',profileName:'PDF/UA-1 validation profile',compliant,details:{passedRules:106,passedChecks:3750,failedRules:compliant?0:1,failedChecks:compliant?0:2,ruleSummaries:compliant?[]:[{specification:'ISO 14289-1:2014',clause:'7.1',testNumber:3,ruleStatus:'FAILED',failedChecks:2,checks:[{context:'private content'}]}]}}]}],batchSummary:{multiJob:false,totalJobs:1,outOfMemory:0,veraExceptions:0,failedParsingJobs:0,failedEncryptedJobs:0,validationSummary:{totalJobCount:1,failedJobCount:0,successfulJobCount:1,compliantPdfaCount:compliant?1:0,nonCompliantPdfaCount:compliant?0:1}}}};}
test('explicit UA1 reports are hash-bound machine-only results and never expose validator file context',()=>{
 const identity={sha256:'a'.repeat(64),bytes:100};for(const compliant of [true,false]){const result=pdfAccessibilityReport(JSON.stringify(report(compliant)),identity);assert.equal(result.compliant,compliant);assert.equal(result.automatedOnly,true);assert.equal(result.profile,'pdfua-1');assert.equal(result.sha256,identity.sha256);assert.doesNotMatch(JSON.stringify(result),/private/);}
 for(const change of [r=>r.report.jobs[0].itemDetails.size++,r=>r.report.jobs[0].validationResult[0].profileName='PDF/A-2u validation profile',r=>r.report.jobs[0].validationResult[0].details.failedRules++,r=>r.report.jobs[0].validationResult[0].details.failedChecks++,r=>r.report.batchSummary.validationSummary.compliantPdfaCount=0,r=>r.report.buildInformation.releaseDetails[0].version='wrong',r=>r.report.batchSummary.failedParsingJobs++]){const value=report();change(value);assert.throws(()=>pdfAccessibilityReport(JSON.stringify(value),identity),{code:'PDF_ACCESSIBILITY_FAILED'});}
});

test('capacity, exact layout and cancellation reject before any worker or validator starts',async()=>{
 assert.equal(validPdfAccessibilityLayout(layout),true);for(const value of [null,{}, {...layout,extra:1},{version:1,layouts:[{...layout.layouts[0],runningText:['x'.repeat(2049)]}]},{version:1,layouts:[{...layout.layouts[0],numberStyle:'invented'}]}])assert.equal(validPdfAccessibilityLayout(value),false);
 await assert.rejects(applyPdfAccessibilityOutput(Buffer.alloc(2),{maxBytes:1}),{code:'PDF_CAPACITY'});await assert.rejects(applyPdfAccessibilityOutput(Buffer.from('%PDF'),{identifyPdfUa:'true'}),{code:'PDF_ACCESSIBILITY_FAILED'});const controller=new AbortController();controller.abort(new Error('Stopped before validation'));await assert.rejects(validatePdfAccessibilityOutput(Buffer.from('%PDF'),{signal:controller.signal}),/Stopped before validation/);await assert.rejects(applyPdfAccessibilityOutput(Buffer.from('%PDF'),{signal:controller.signal}),/Stopped before validation/);
});
