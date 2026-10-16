import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {validateNotebook} from '../src/model.js';
import {buildPublication,publicProjection,verifyPublication} from '../src/publication.js';
import {publicationPage} from '../src/publication-page.js';
import {newElement} from '../src/web/composition-tree.js';
import {validSections,validSiteLayout} from '../src/web/website-model.js';
import {validActionStyle,actionStyleRules,sectionActionRules} from '../src/web/website-action-style.js';

test('text links, buttons and close controls retain separate inherited and individual appearance',()=>{
 const book=sampleNotebook(),link={...newElement('link',randomUUID),label:'Read the work',href:'https://example.org'},button={...newElement('link',randomUUID),label:'Support',action:{appearance:'button',arrow:true,style:{radius:24,background:'#123456',font:'modern'}}},popup={...newElement('popup',randomUUID),title:'Support choices',close:{content:'both',label:'Return',appearance:'button',style:{color:'#abcdef',radius:9}}};
 book.website.design.buttons={background:'#765432',color:'#ffffff',radius:8,font:'editorial'};book.website.design.links={color:'#345678',underline:true};book.website.home.sections=[link,button,popup];validateNotebook(book);
 const site=buildPublication(book);verifyPublication(site);const html=site.files.get('index.html'),css=site.files.get('styles.css');
 assert.match(html,/class="site-action site-action--link" href="https:\/\/example.org"[^>]*>Read the work<\/a>/);assert.match(html,/class="site-action site-action--button"[^>]*>Support <span/);assert.match(html,/class="site-action site-action--button public-popup-close" aria-label="Return"><span aria-hidden="true" data-close-icon>×<\/span><span>Return<\/span>/);
 assert.ok(css.includes('--button-background:#765432'));assert.ok(css.includes('--link-color:#345678'));assert.ok(css.includes('[data-section-id="'+button.id+'"] > .site-action{--action-radius:24px;--action-background:#123456;--action-font:system-ui,sans-serif;--action-font-axes:normal}'));
 assert.ok(css.includes('[data-section-id="'+popup.id+'"] > .public-popup > .popup-body > .popup-controls > .site-action'));assert.ok(css.includes('--action-color:#abcdef;--action-radius:9px'));
 const plan=publicationPage(publicProjection(book),'home');assert.ok(plan.fonts.some(v=>v?.font==='modern'));assert.ok(plan.fonts.some(v=>v?.font==='editorial'));
 delete button.action;const legacy=buildPublication(book).files.get('index.html');assert.match(legacy,/class="site-action site-action--button"[^>]*>Support <span/);
 popup.close={content:'text',label:'close',appearance:'link'};validateNotebook(book);const textOnly=buildPublication(book).files.get('index.html');assert.match(textOnly,/public-popup-close" aria-label="close"><span>close<\/span>/);
});

test('action typography keeps weight controls effective with variable fonts and isolates a changed family',()=>{
 assert.equal(actionStyleRules({fontAxes:{wght:650,opsz:16}}),'--action-font-axes:"opsz" 16;--action-font-weight:650');
 assert.match(actionStyleRules({font:'modern'}),/--action-font-axes:normal/);
 const section={...newElement('popup',randomUUID),close:{appearance:'button',style:{fontWeight:550,fontAxes:{opsz:24,wght:700}}}};
 const css=sectionActionRules(section,'#popup').join('');assert.match(css,/--action-font-weight:550/);assert.match(css,/--action-font-axes:"opsz" 24/);assert.doesNotMatch(css,/weight:700/);
});

test('action styles reject arbitrary CSS and misplaced controls without restricting authors to presets',()=>{
 for(const style of [{color:'red;display:none'},{font:'url(https://example.org)'},{radius:-1},{fontWeight:1001},{fontSize:Infinity},{position:'fixed'},{width:400},{underline:'true'}])assert.equal(validActionStyle(style),false);
 assert.ok(validActionStyle({fontSize:97,paddingY:72,radius:250,borderWidth:0,background:'transparent',hoverColor:'#112233',fontWeight:450,lineHeight:1.2,letterSpacing:-.25}));
 const link=newElement('link',randomUUID);assert.equal(validSections([{...link,close:{content:'text'}}]),false);assert.equal(validSections([{...link,action:{appearance:'panel'}}]),false);assert.equal(validSections([{...newElement('text',randomUUID),action:{appearance:'button'}}]),false);
 const book=sampleNotebook();book.website.design.buttons={unknown:1};assert.equal(validSiteLayout(book.website.design),false);
});
