import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfPageMasterDefaults,validPdfPageMaster,validPdfPageMasterGeometry,pdfPageMargins,pdfPageContentBox,pdfPageMasterHasSection} from '../src/web/pdf-page-master-model.js';
import {pdfPageMasterCSS,pdfPageMasterText} from '../src/pdf-page-master.js';
import {pdfPageMasterFields,changePdfPageMaster} from '../src/web/pdf-page-master-fields.js';
const layout=()=>{const value=pdfLayoutPreset();value.pageMaster=pdfPageMasterDefaults(value);return value;};
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

test('facing PDF pages mirror inner margins and reserve the gutter in physical column geometry',()=>{
 const value=layout();value.margins={top:17,right:12,bottom:23,left:28};value.pageMaster.facingPages=true;value.pageMaster.gutterMm=9;value.columns=2;value.columnGapMm=8;
 assert.deepEqual(pdfPageMargins(value,'right'),{top:17,right:12,bottom:23,left:37});assert.deepEqual(pdfPageMargins(value,'left'),{top:17,right:37,bottom:23,left:12});assert.deepEqual(pdfPageContentBox(value),{widthMm:161,heightMm:257,columnWidthMm:76.5});assert.equal(validPdfPageMasterGeometry(value),true);
 const css=pdfPageMasterCSS(value,'report');assert.match(css,/@page report:left\{margin:17mm 37mm 23mm 12mm;\}/);assert.match(css,/@page report:right\{margin:17mm 12mm 23mm 37mm;\}/);
 value.pageMaster.facingPages=false;assert.deepEqual(pdfPageMargins(value,'left'),pdfPageMargins(value,'right'));assert.ok(!pdfPageMasterCSS(value,'report').includes('@page report:left'));
 value.widthMm=96;assert.equal(validPdfPageMasterGeometry(value),false);assert.throws(()=>pdfPageMasterCSS(value,'report'),{code:'PDF_LAYOUT'});value.widthMm=97;assert.equal(pdfPageContentBox(value).columnWidthMm,20);assert.equal(validPdfPageMasterGeometry(value),true);
});

test('page master replaces six margin boxes and scopes first-page visibility without resetting section page numbers',()=>{
 const value=layout();value.pageMaster.firstPageHeader=false;value.pageMaster.firstPageFooter=false;value.pageMaster.numberStart=12;value.pageMaster.numberStyle='lower-roman';value.pageMaster.header.left='{section}';value.pageMaster.footer.center='Page {page} of {pages}';
 const global=pdfPageMasterCSS(value,''),named=pdfPageMasterCSS(value,'report',{sectionTitle:'Results'});
 assert.match(global,/@page:first\{counter-increment:page 12;/);assert.ok(!named.includes('counter-reset'));assert.match(named,/@page report:first\{@top-left\{content:none\}@top-center\{content:none\}@top-right\{content:none\}@bottom-left\{content:none\}@bottom-center\{content:none\}@bottom-right\{content:none\}\}/);
 assert.ok(named.includes('content:"Results"'));assert.ok(named.includes('content:"Page " counter(page,lower-roman) " of " counter(pages,lower-roman)'));assert.equal(pdfPageMasterHasSection(value),true);
 assert.ok(pdfPageMasterText(value,'Results').includes('ivxlcdm'));assert.ok(pdfPageMasterText(value,'Results').includes('Results'));
 for(const style of ['decimal','upper-roman']){value.pageMaster.numberStyle=style;const css=pdfPageMasterCSS(value,'report');assert.ok(css.includes('counter(page,'+style+')'));assert.ok(css.includes('counter(pages,'+style+')'));}
 assert.ok(pdfPageMasterText(value).includes('IVXLCDM'));
});

test('authored page labels stay CSS strings, section substitution is literal and invalid selectors cannot escape',()=>{
 const value=layout();value.pageMaster.header.center='Quote " and slash \\ </style><script>bad</script> {section} {page} {unknown}';
 const css=pdfPageMasterCSS(value,'safe-page',{sectionTitle:'A\n{page}\tB'});
 assert.ok(!css.includes('</style>'));assert.ok(!css.includes('<script>'));assert.ok(css.includes('\\3c /style\\3e '));assert.ok(css.includes('\\"'));assert.ok(css.includes('\\\\'));assert.ok(css.includes('"A\\a {page}\\9 B"'));assert.equal((css.match(/counter\(page,decimal\)/g)??[]).length,2);assert.ok(css.includes('{unknown}'));
 for(const name of ['x}body{','x:y','@page','a b','a'.repeat(129)])assert.throws(()=>pdfPageMasterCSS(value,name),{code:'PDF_LAYOUT'});
 value.color='red;content:url(https://invalid.example)';assert.throws(()=>pdfPageMasterCSS(value,'safe'),{code:'PDF_LAYOUT'});
});

test('page-master opt-in preserves legacy output and bounded fields cannot change unrelated layout paths',()=>{
 const value=pdfLayoutPreset();value.header='Existing heading';value.footer='Existing footer';assert.equal(pdfPageMasterCSS(value,'legacy'),'');assert.equal(pdfPageMasterText(value),'');assert.equal(pdfPageMasterHasSection(value),false);
 assert.equal(changePdfPageMaster(value,'master.enabled',true),true);assert.ok(validPdfPageMaster(value.pageMaster));assert.equal(value.pageMaster.header.center,value.header);assert.equal(value.pageMaster.footer.left,value.footer);assert.equal(value.pageMaster.footer.right,'{page}');
 assert.equal(changePdfPageMaster(value,'master.header.left','<authored> "label"'),true);assert.equal(changePdfPageMaster(value,'master.numberStart','7'),true);assert.equal(value.pageMaster.numberStart,7);assert.equal(changePdfPageMaster(value,'master.header.__proto__','invalid'),false);assert.equal(changePdfPageMaster(value,'font','invalid'),false);
 const html=pdfPageMasterFields(value,'document',{esc});assert.ok(html.includes('data-key="master.header.left"'));assert.ok(html.includes('&lt;authored&gt; &quot;label&quot;'));assert.ok(html.includes('min="1" max="9999"'));assert.ok(!html.includes('<authored>'));assert.ok(!pdfPageMasterFields(value,'section',{esc}).includes('data-key=\"master.numberStart\"'));
 const base=structuredClone(value.pageMaster);for(const changed of [{...base,gutterMm:101},{...base,numberStart:0},{...base,numberStart:1.5},{...base,numberStyle:'url(x)'},{...base,header:{...base.header,left:'x'.repeat(241)}},{...base,footer:{...base.footer,right:'line\nbreak'}},{...base,extra:true}])assert.equal(validPdfPageMaster(changed),false);
 changePdfPageMaster(value,'master.enabled',false);assert.equal(Object.hasOwn(value,'pageMaster'),false);assert.equal(pdfPageMasterCSS(value,'legacy'),'');assert.equal(value.header,'Existing heading');assert.equal(value.footer,'Existing footer');assert.ok(pdfPageMasterFields(value,'document',{esc}).includes('data-pdf-master-controls disabled'));
});
