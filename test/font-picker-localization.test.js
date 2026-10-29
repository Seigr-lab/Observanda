import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {fontSelect,axisControls} from '../src/web/font-picker.js';
import {BUNDLED_FONTS,FONT_OPTIONS,setCustomFonts,fontAxes} from '../src/web/font-catalogue.js';
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
test('system font options and bundled axis labels translate while font metadata and chosen values stay canonical',async context=>{
 context.after(()=>activateLanguage('en'));const before=structuredClone(BUNDLED_FONTS),options=structuredClone(FONT_OPTIONS),variable=BUNDLED_FONTS.find(font=>font.faces[0].axes.opsz);
 for(const locale of ['en','ca','es','nb','nn']){
  await load(locale);activateLanguage(locale);const picker=fontSelect('id="font"','modern');
  assert.ok(picker.includes(esc(t('fonts','systemSans'))));assert.ok(picker.includes(esc(t('fonts','systemSerif'))));assert.match(picker,/value="modern" selected/);
  const axes=axisControls(variable.id,{opsz:fontAxes(variable.id).opsz.default});assert.ok(axes.includes(esc(t('fonts','axisOpticalSize'))));assert.ok(axes.includes(esc(t('fonts','axisWeight'))));assert.ok(axes.includes('data-font-axis="opsz"'));
  assert.deepEqual(BUNDLED_FONTS,before);assert.deepEqual(FONT_OPTIONS,options);
 }
});
test('custom font names and custom axis metadata remain exact and escaped even for standard axis tags',async context=>{
 const id='custom-'+'a'.repeat(64),font={id,label:'Authored <font> & name',hidden:false,faces:[{file:id+'.woff2',axes:{wght:{name:'Authored <weight> & axis',min:100,max:900,default:400}}}]};
 context.after(()=>{setCustomFonts([]);activateLanguage('en');});setCustomFonts([font]);const before=structuredClone(font);
 for(const locale of ['ca','es','nb','nn']){
  await load(locale);activateLanguage(locale);const picker=fontSelect('',id),axes=axisControls(id,{wght:500});
  assert.ok(picker.includes(esc(font.label)));assert.ok(!picker.includes('<font>'));assert.ok(axes.includes(esc(font.faces[0].axes.wght.name)));assert.ok(!axes.includes('<weight>'));assert.match(axes,/value="500"/);assert.deepEqual(font,before);
 }
});
