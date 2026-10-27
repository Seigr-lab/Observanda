import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyRichTextStyles} from '../src/web/rich-text-stylesheet.js';

const writing=marks=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Retained observation',marks}]}]});
const color=writing([{type:'text_color',attrs:{color:'#123456'}}]);
const highlight=writing([{type:'highlight',attrs:{color:'#fedcba'}}]);
const font=writing([{type:'font_family',attrs:{font:'editorial'}}]);
const sheet=()=>({cssRules:[],insertRule(rule,index){this.cssRules.splice(index,0,rule);}});

test('document styles cover selected writing fields without reading other record content',()=>{
 const target=sheet(),doc={querySelector:()=>({sheet:target})};
 const record={body:color,sections:[{body:highlight}],template:{values:{caption:font,plain:'Text'}},get attachments(){throw Error('Unrelated evidence must not be inspected');}};
 applyRichTextStyles(doc,record);applyRichTextStyles(doc,record);
 assert.deepEqual(target.cssRules,['.rt-color-123456{color:#123456}','.rt-highlight-fedcba{background-color:#fedcba}','.rt-font-editorial{font-family:Georgia,serif}']);
});

test('late or replaced document stylesheets can receive already displayed formatting',()=>{
 let target=null;const doc={querySelector:selector=>{assert.equal(selector,'link[data-document-styles]');return {sheet:target};}};
 applyRichTextStyles(doc,color);target=sheet();applyRichTextStyles(doc,color);assert.equal(target.cssRules.length,1);
 target=sheet();applyRichTextStyles(doc,color);assert.deepEqual(target.cssRules,['.rt-color-123456{color:#123456}']);
});
