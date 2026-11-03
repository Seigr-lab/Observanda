import {parse} from 'parse5';
import {attr,descendants} from './website-migration-views.js';

// The publication theme uses .site-menu lists and native .site-submenu
// disclosures. Apply their layout only to the menu created by the file editor.
export const menuCSS=`:where(nav[data-website-menu]){box-sizing:border-box;max-inline-size:var(--site-width,75rem);margin-inline:auto;padding: .65rem clamp(1rem,3vw,2rem);border-block-end:1px solid var(--page-border,currentColor);color:inherit;font:inherit}
:where(nav[data-website-menu] .site-menu){display:flex;flex-wrap:wrap;align-items:center;gap:.35rem .9rem;list-style:none;padding:0;margin:0}
:where(nav[data-website-menu] .site-menu>li){display:flex;align-items:center;gap:.15rem;position:relative;min-inline-size:0}
:where(nav[data-website-menu] a,nav[data-website-menu] summary){box-sizing:border-box;display:inline-flex;align-items:center;min-block-size:2.4rem;padding:.35rem .65rem;border-radius:var(--corner-radius,.35rem);font:inherit;font-weight:600;color:inherit;text-decoration:none;line-height:1.35;overflow-wrap:anywhere}
:where(nav[data-website-menu] a:hover,nav[data-website-menu] summary:hover){text-decoration:underline;text-underline-offset:.2em}
:where(nav[data-website-menu] a[aria-current=page]){color:var(--accent,currentColor);text-decoration:underline;text-decoration-thickness:.16em;text-underline-offset:.25em}
:where(nav[data-website-menu] a:focus-visible,nav[data-website-menu] summary:focus-visible){outline:2px solid var(--accent,currentColor);outline-offset:2px}
:where(nav[data-website-menu] .site-submenu){margin:0}
:where(nav[data-website-menu] .site-submenu>summary){cursor:pointer;list-style:none;padding-inline:.5rem}
:where(nav[data-website-menu] .site-submenu>summary)::-webkit-details-marker{display:none}
:where(nav[data-website-menu] .site-submenu>.site-menu){position:absolute;z-index:2;inset-block-start:100%;inset-inline-start:0;display:flex;align-items:stretch;flex-direction:column;gap:.15rem;min-inline-size:min(12rem,80vw);max-inline-size:min(22rem,85vw);padding:.45rem;background:var(--page-surface,Canvas);color:var(--page-text,CanvasText);border:1px solid var(--page-border,currentColor);border-radius:var(--corner-radius,.35rem)}
:where(nav[data-website-menu] .site-submenu>.site-menu>li){flex-wrap:wrap}
:where(nav[data-website-menu] .site-submenu .site-submenu>.site-menu){position:static;min-inline-size:0;margin-block:.25rem;padding-inline-start:.65rem;border:0;border-inline-start:1px solid var(--page-border,currentColor)}
@media(max-width:48rem){:where(nav[data-website-menu] .site-submenu>.site-menu){position:static;min-inline-size:0}:where(nav[data-website-menu] .site-menu>li){flex-wrap:wrap}}
`;
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
