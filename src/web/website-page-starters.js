import {createSection,sectionCSS} from './website-section-templates.js';
import {buttonCSS} from './website-files-dialogs.js';

// Whole-page starters for a new page: recipes of the ready-made sections an
// author can also add one by one. Each card previews the page with the
// website's own stylesheet; the sections are written through the editor and
// then rewritten in place like any other.
export const PAGE_STARTERS={
 blank:[],
 landing:['heroSection','featuresSection','ctaSection'],
 about:['heroSection','quoteSection','stepsSection'],
 steps:['heroSection','stepsSection','ctaSection'],
 contact:['heroSection','contactSection']
};
const sectionsCSS=()=>sectionCSS+buttonCSS;

export function websitePageStarters({t,esc}){
 const key=(id,suffix='')=>'pageStarter_'+id+suffix;
 function view(chosen='blank'){
  const card=id=>'<label class="website-starter"><span class="website-starter-preview" aria-hidden="true"><iframe sandbox="" tabindex="-1" title="" data-page-starter-preview="'+id+'"></iframe></span>'+
   '<span class="website-starter-choice"><input type="radio" name="page-starter" data-website-file-field="pageStarter" value="'+id+'"'+(id===chosen?' checked':'')+'><span><strong>'+esc(t(key(id)))+'</strong><span class="hint">'+esc(t(key(id,'Text')))+'</span></span></span></label>';
  return '<fieldset class="website-starters website-page-starters"><legend>'+esc(t('pageStarterChoose'))+'</legend><p class="hint website-starters-help">'+esc(t('pageStarterHelp'))+'</p>'+Object.keys(PAGE_STARTERS).map(card).join('')+'</fieldset>';
 }
 // The page as it will be created: its title and sections, in the site's stylesheet.
 function preview(id,{title,css}){
  const doc=document.implementation.createHTMLDocument(title);
  const main=doc.createElement('main'),heading=doc.createElement('h1');heading.textContent=title;main.append(heading);
  for(const type of PAGE_STARTERS[id]??[])main.append(createSection(doc,type,t));
  doc.body.append(main);
  // The stylesheet joins as text: a style element built inside the app would fall under
  // the app's own style policy. A closing tag inside the text cannot end it early.
  const style='<style>'+(css+'\n'+sectionsCSS()).replace(/<\/(style)/gi,'<\\/$1')+'</style>';
  return '<!doctype html>'+doc.documentElement.outerHTML.replace('</head>',style+'</head>');
 }
 // `show` puts the page in its frame; the editor serves it so the page's own styles apply.
 function paint(root,{title,css,show}){
  for(const frame of root.querySelectorAll('[data-page-starter-preview]'))show(frame,preview(frame.dataset.pageStarterPreview,{title,css}));
 }
 // Adds the starter's sections to a new page; returns whether the site's
 // stylesheet needs the shared section and button styles.
 function apply(id,doc,main){
  const types=PAGE_STARTERS[id]??[];
  for(const type of types)main.append(createSection(doc,type,t));
  return types.length>0;
 }
 return {view,paint,apply};
}
