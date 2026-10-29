import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {websiteUI} from '../src/web/website-ui.js';
import {fontDisplayName} from '../src/web/font-picker.js';
import {FONT_OPTIONS} from '../src/web/themes.js';
import {newElement,ELEMENTS} from '../src/web/composition-tree.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
const locales=['en','ca','es','nb','nn'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const field=(label,control)=>'<label>'+label+control+'</label>';
const option=(value,label,current)=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>';
function setup(context){
 const previous={document:globalThis.document,window:globalThis.window,sessionStorage:globalThis.sessionStorage,confirm:globalThis.confirm};
 Object.assign(globalThis,{document:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},window:{scrollY:0},sessionStorage:{getItem:()=>null,setItem(){}},confirm:()=>false});
 context.after(()=>{Object.assign(globalThis,previous);activateLanguage('en');});
 const book=upgradeNotebook(sampleNotebook());book.website.home.enabled=true;book.website.home.sections=[{...newElement('text'),title:'Authored <title> & text',body:'Authored text stays exact.'},{...newElement('hero'),title:''}];
 const state={book,page:'website',etag:'etag',storage:{contextId:'context'}};
 const ui=websiteUI({state,api:async()=>{assert.fail('Presentation must not make a request');},esc,field,option,icon:()=>'',dirty(){},render(){},notify(){},showDialog(){},selection:{snapshot:()=>({})}});
 const action=(name,data={})=>ui.action({dataset:{action:name,...data},closest:()=>null});
 return {state,ui,action};
}
test('website canvas and palette translate in all languages while draft content stays exact',async context=>{
 const {state,ui}=setup(context),before=structuredClone(state.book),elements=structuredClone(ELEMENTS);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);const html=ui.view();
  for(const key of ['editorWebsite','editorEditingTools','editorPageCanvas','editorViewport','editorUndo','editorRedo','editorMoveHelp','editorSearchElements'])assert.ok(html.includes(esc(t('websiteAuthoring',key))),key+' '+locale);
  for(const element of ELEMENTS)assert.ok(html.includes(esc(t('compositionControls','element_'+element.kind))),element.kind+' '+locale);
  assert.ok(html.includes(esc(before.website.home.sections[0].title)));assert.ok(!html.includes('<title>'));
  assert.ok(html.includes(esc(t('compositionControls','element_hero'))));assert.deepEqual(state.book,before);assert.deepEqual(ELEMENTS,elements);
 }
});
test('site typography, layout and home settings use translated labels and canonical option values',async context=>{
 const {state,ui,action}=setup(context),before=structuredClone(state.book);ui.view();
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  await action('website-tool',{tool:'site'});let html=ui.view();assert.ok(html.includes(esc(t('websiteAuthoring','editorLayoutBranding'))));assert.ok(!html.includes('&amp;amp;'));
  await action('website-tool',{tool:'typography'});html=ui.view();assert.ok(html.includes(esc(t('websiteAuthoring','editorBodyFont'))));assert.ok(html.includes(esc(t('websiteAuthoring','editorThemeFont',{font:fontDisplayName(state.book.appearance.font,FONT_OPTIONS.find(([id])=>id===state.book.appearance.font)?.[1]??t('websiteAuthoring','editorCustomFont'))}))));
  await action('website-type-tab',{tab:'spacing'});html=ui.view();assert.ok(html.includes(esc(t('websiteAuthoring','editorParagraphSpacingEm'))));
  await action('website-tool',{tool:'layout'});html=ui.view();assert.ok(html.includes(esc(t('websiteAuthoring','editorSiteNavigation'))));assert.ok(html.includes('value="top"'));
  await action('website-design-tab',{tab:'colors'});html=ui.view();assert.ok(html.includes(esc(t('websiteAuthoring','editorLinksAccents'))));assert.ok(!html.includes('&amp;amp;'));
  await action('website-tool',{tool:'page-settings'});html=ui.view();assert.ok(html.includes(esc(t('websiteAuthoring','editorHomepageHeading'))));assert.deepEqual(state.book,before);
  await action('website-type-tab',{tab:'fonts'});await action('website-design-tab',{tab:'layout'});
 }
});
test('section accessibility phrases and layout options translate without rewriting selected sections',async context=>{
 const {state,ui,action}=setup(context),before=structuredClone(state.book);ui.view();
 for(const locale of locales){
  await load(locale);activateLanguage(locale);await action('website-edit-section',{id:state.book.website.home.sections[0].id});
  let html=ui.view();for(const key of ['editorSectionTools','editorSectionHeading','editorEditTextOnPage'])assert.ok(html.includes(esc(t('websiteAuthoring',key))));
  assert.ok(html.includes(esc(t('websiteAuthoring','editorMoveUp',{number:1}))));assert.ok(html.includes(esc(t('websiteAuthoring','editorIncludeSection',{number:1}))));
  await action('website-section-tab',{tab:'layout'});html=ui.view();assert.ok(html.includes(esc(t('websiteAuthoring','editorTwoThirds'))));assert.ok(html.includes('value="two-thirds"'));assert.ok(html.includes(esc(t('websiteAuthoring','editorTextAlignment'))));
  await action('website-section-tab',{tab:'style'});html=ui.view();assert.ok(html.includes(esc(t('websiteAuthoring','editorSectionTextSizePx'))));assert.deepEqual(state.book,before);
 }
});
test('media compatibility failures and removal confirmation follow the current language before any mutation',async context=>{
 const {state,ui,action}=setup(context);const asset={id:'asset',kind:'image'};state.book.website.assets=[asset];const before=structuredClone(state.book);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  await assert.rejects(ui.acceptAsset({...asset,kind:'audio'},'library'),{message:t('websiteAuthoring','editorMediaTypeMismatch')});
  let question;globalThis.confirm=value=>{question=value;return false;};await action('website-remove-home');assert.equal(question,t('websiteAuthoring','editorRemoveHomeConfirm'));assert.deepEqual(state.book,before);
 }
});
