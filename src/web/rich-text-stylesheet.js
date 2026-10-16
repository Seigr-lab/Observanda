import {richTextStyles} from './rich-text-model.js';

export function applyRichTextStyles(doc,value){
 const sheet=[...doc.styleSheets].find(s=>s.href?.endsWith('/rich-text-editor.css'));if(!sheet)return;
 const rules=richTextStyles([value]).css.split('\n').filter(Boolean);doc.editorTextRules??=new Set();
 for(const rule of rules)if(!doc.editorTextRules.has(rule)){sheet.insertRule(rule,sheet.cssRules.length);doc.editorTextRules.add(rule);}
}
