import {parse} from 'parse5';
import {attr,descendants} from './website-migration-views.js';

export {menuCSS} from './web/website-menu-theme.js';
export const hasEditorMenu=nodes=>nodes.some(n=>n.tagName==='nav'&&attr(n,'data-website-menu')!==undefined&&[...descendants(n)].some(c=>c.tagName==='a'));
const known=new Map();
export async function fileHasEditorMenu(store,file,signal){
 if(file.editorMenu!==undefined)return file.editorMenu;
 if(!known.has(file.sha256)){
  const html=await store.readText(file,{signal}),menu=html.includes('data-website-menu')&&hasEditorMenu([...descendants(parse(html))]);
  known.set(file.sha256,menu);if(known.size>2048)known.delete(known.keys().next().value);
 }
 return known.get(file.sha256);
}
