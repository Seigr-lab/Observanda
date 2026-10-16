import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {validateNotebook} from '../src/model.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {assertPublicFiles} from '../src/privacy.js';
import {PUBLIC_POPUPS_SCRIPT,copyTextMarkup} from '../src/publication-popups.js';
import {newElement,insertElement,cloneElements} from '../src/web/composition-tree.js';
import {validSections} from '../src/web/website-model.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {footerTextAlignment} from '../src/web/website-footer.js';

test('popup composition retains distinct support links and exact public copy values through publication',()=>{
 const book=sampleNotebook(),popup={...newElement('popup',randomUUID),title:'Support the work',label:'Support',dialogWidth:740},copy={...newElement('copy-text',randomUUID),title:'Example network',body:'Use the specified network',value:'  0xAbCd001122\r\nExactSecondLine  ',label:'Copy address'},link={...newElement('link',randomUUID),label:'Support link',href:'https://example.org/support?a=1&b=2'};
 book.website.home.sections=insertElement(insertElement([popup],copy,popup.id),link,popup.id);validateNotebook(book);
 const site=buildPublication(book);verifyPublication(site);const html=site.files.get('index.html');
 assert.ok(html.includes('data-public-popup'));assert.match(html,/<summary[^>]*>Support<\/summary>/);assert.ok(html.includes('readonly'));assert.ok(html.includes('role="status"'));assert.ok(html.includes('href="https://example.org/support?a=1&amp;b=2"'));assert.ok(html.includes('ExactSecondLine  '));assert.ok(html.includes('\\r\\n'));assert.ok(site.files.get('styles.css').includes('--popup-width:740px'));assert.equal(site.files.get('public-popups.js'),PUBLIC_POPUPS_SCRIPT);
 assert.ok(validSections(cloneElements(book.website.home.sections,randomUUID)));assert.throws(()=>assertPublicFiles(new Map([['public-popups.js',PUBLIC_POPUPS_SCRIPT+'alert(1)']])),{code:'UNSAFE'});
 popup.show=false;const hidden=buildPublication(book);assert.ok(!hidden.files.get('index.html').includes('0xAbCd'));assert.ok(!hidden.files.get('index.html').includes('example.org/support'));assert.ok(!hidden.files.has('public-popups.js'));
});

test('copy text is escaped, untruncated and valid as a standalone element; private page contents are excluded',()=>{
 const copy={...newElement('copy-text',randomUUID),title:'Literal text',value:'</textarea><script>bad()</script> & " '.repeat(4000)};
 assert.ok(validSections([copy]));const esc=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const html=copyTextMarkup(copy,esc);assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;/textarea&gt;'));assert.equal((html.match(/&lt;script&gt;/g)??[]).length,8000);
 const book=sampleNotebook();book.website.home.sections=[];book.pages.push({id:randomUUID(),title:'Private support',body:'',share:false,sections:[copy]});validateNotebook(book);const site=buildPublication(book);assert.ok(!site.files.has('public-popups.js'));assert.ok(![...site.files.values()].some(value=>typeof value==='string'&&value.includes('bad()')));
 for(const change of [{value:42},{value:'invalid\u0000text'},{label:[] }])assert.equal(validSections([{...copy,...change}]),false);
 const popup=newElement('popup',randomUUID);for(const dialogWidth of [0,-1,1.5,Infinity,'640'])assert.equal(validSections([{...popup,dialogWidth}]),false);assert.ok(validSections([{...popup,dialogWidth:4000}]));
});

test('support popups reuse authored footers with unique anchors and per-page exclusions',()=>{
 const book=sampleNotebook(),popup={...newElement('popup',randomUUID),title:'Support'},copy={...newElement('copy-text',randomUUID),title:'Network',value:'ExactPublicAddress',parentId:popup.id};book.website.home.sections=[popup,copy];
 const footer=createRegion(book.website,'footer','PRIVATE_REGION_NAME',{makeId:randomUUID});footer.sections=structuredClone([popup,copy]);assignRegion(book.website,'*','footer',footer.id);
 const page={id:randomUUID(),title:'Independent page',body:'',share:true,sections:[]};book.pages.push(page);assignRegion(book.website,'page:'+page.id,'footer',null);validateNotebook(book);
 const site=buildPublication(book);verifyPublication(site);const home=site.files.get('index.html'),other=site.files.get('pages/'+page.id+'.html');
 assert.ok(home.includes('id="section-'+popup.id+'-title"'));assert.ok(home.includes('id="footer-section-'+popup.id+'-title"'));assert.ok(!home.includes('PRIVATE_REGION_NAME'));assert.ok(!other.includes('ExactPublicAddress'));
 footer.sections.unshift({...newElement('text',randomUUID),body:'Footer text',style:{width:'full',surface:'none',space:'normal',align:'center'}});assert.equal(footerTextAlignment(footer),'center');
});
