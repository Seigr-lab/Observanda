// The author's own app themes: choose a theme, create one from the theme in use,
// and change its colours, fonts and shapes with the whole app as the live preview.
import {t} from './i18n/index.js';
import {APP_THEME_COLORS,activeAppTheme,appThemeChoice} from './app-themes.js';
import {STARTING_THEMES,contrastRatio} from './themes.js';
import {fontSelect} from './font-picker.js';
import {confirmAction} from './confirm-action.js';

const text=(key,args)=>t('interface',key,args);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const swatches=a=>'<span class="app-theme-swatches" aria-hidden="true">'+['background','surface','accent','text'].map(key=>'<span data-swatch="'+key+'"></span>').join('')+'</span>';

export function appThemeEditor(){
 function themes(settings){
  return [...Object.keys(STARTING_THEMES).map(id=>({id,name:t('appearance',id+'Name'),own:false})),...(settings.appThemes??[]).map(item=>({id:item.id,name:item.name,own:true}))];
 }
 function card(settings,item){
  const appearance=item.own?settings.appThemes.find(own=>own.id===item.id).appearance:activeAppTheme({appTheme:item.id});
  const vars=APP_THEME_COLORS.map(key=>'--swatch-'+key+':'+appearance[key]).join(';');
  // Swatch colours are the theme's own data, set as custom properties through a class-free attribute.
  return '<button type="button" class="app-theme-card" data-action="app-theme-use" data-theme-id="'+esc(item.id)+'" aria-pressed="'+String(settings.appTheme===item.id)+'" data-swatch-values="'+esc(vars)+'">'+swatches(appearance)+'<span>'+esc(item.name)+(item.own?'<small>'+esc(text('themeOwn'))+'</small>':'')+'</span></button>';
 }
 function contrast(a){
  const checks=[['contrastText',Math.min(contrastRatio(a.text,a.background),contrastRatio(a.text,a.surface)),4.5],['contrastMuted',Math.min(contrastRatio(a.muted,a.background),contrastRatio(a.muted,a.surface)),4.5],['contrastAccent',Math.min(contrastRatio(a.accent,a.background),contrastRatio(a.accent,a.surface)),3]];
  return '<ul class="app-theme-contrast">'+checks.map(([key,ratio,minimum])=>'<li data-contrast-ok="'+String(ratio>=minimum)+'">'+esc(text(key))+' · '+ratio.toFixed(1)+':1 '+esc(text(ratio>=minimum?'contrastGood':'contrastLow'))+'</li>').join('')+'</ul>';
 }
 function editor(settings){
  const own=(settings.appThemes??[]).find(item=>item.id===settings.appTheme);
  if(!own)return '<p class="muted">'+esc(text('themeStartingHelp'))+'</p>';
  const a=own.appearance,color=key=>'<label class="app-theme-color"><input type="color" data-app-theme="'+key+'" value="'+esc(a[key])+'"><span><strong>'+esc(text('themeColor_'+key))+'</strong><small>'+esc(text('themeColor_'+key+'Help'))+'</small></span></label>';
  return '<section class="app-theme-editor" aria-label="'+esc(text('themeEdit'))+'"><label class="field"><span>'+esc(text('themeName'))+'</span><input data-app-theme="name" maxlength="80" required value="'+esc(own.name)+'"></label>'+
   '<fieldset><legend>'+esc(text('themeColors'))+'</legend><div class="app-theme-colors">'+APP_THEME_COLORS.map(color).join('')+'</div>'+contrast(a)+'</fieldset>'+
   '<fieldset><legend>'+esc(text('themeText'))+'</legend><div class="form-grid"><label class="field"><span>'+esc(text('themeFont'))+'</span>'+fontSelect('data-app-theme="font"',a.font)+'</label><label class="field"><span>'+esc(text('themeHeadingFont'))+'</span>'+fontSelect('data-app-theme="headingFont"',a.headingFont)+'</label></div></fieldset>'+
   '<fieldset><legend>'+esc(text('themeShape'))+'</legend><div class="form-grid"><label class="field"><span>'+esc(text('themeRadius'))+' <output>'+a.radius+' px</output></span><input type="range" min="0" max="24" step="1" data-app-theme="radius" value="'+a.radius+'"></label>'+
   '<label class="field"><span>'+esc(text('themeDensity'))+'</span><select data-app-theme="density">'+['comfortable','compact'].map(value=>'<option value="'+value+'"'+(a.density===value?' selected':'')+'>'+esc(text('density_'+value))+'</option>').join('')+'</select></label></div></fieldset>'+
   '<div class="inline-actions"><button type="button" class="button" data-action="app-theme-duplicate">'+esc(text('themeDuplicate'))+'</button><button type="button" class="button danger" data-action="app-theme-delete">'+esc(text('themeDelete'))+'</button></div></section>';
 }
 function view(settings){
  return '<section class="app-theme-chooser" aria-label="'+esc(text('appTheme'))+'"><h3>'+esc(text('appTheme'))+'</h3><p class="muted">'+esc(text('themeHelp'))+'</p><div class="app-theme-cards">'+themes(settings).map(item=>card(settings,item)).join('')+
   '<button type="button" class="app-theme-card app-theme-create" data-action="app-theme-new">'+esc(text('themeCreate'))+'</button></div>'+editor(settings)+'</section>';
 }
 // Swatch colours come from theme data; they are set as custom properties, never as markup styles.
 function paint(root=document){
  for(const node of root.querySelectorAll('[data-swatch-values]')){for(const pair of node.dataset.swatchValues.split(';')){const [key,value]=pair.split(':');node.style.setProperty(key,value);}}
 }
 function input(el,settings){
  const key=el.dataset.appTheme;if(!key)return false;
  const own=(settings.appThemes??[]).find(item=>item.id===settings.appTheme);if(!own)return true;
  if(key==='name'){own.name=el.value.slice(0,80);const label=document.querySelector('.app-theme-card[data-theme-id="'+CSS.escape(own.id)+'"] > span:last-child');if(label?.firstChild)label.firstChild.textContent=own.name;}
  else if(key==='radius'){own.appearance.radius=Number(el.value);const out=el.closest('label')?.querySelector('output');if(out)out.textContent=el.value+' px';}
  else{own.appearance[key]=el.value;if(APP_THEME_COLORS.includes(key)){document.querySelector('.app-theme-card[data-theme-id="'+CSS.escape(own.id)+'"]')?.style.setProperty('--swatch-'+key,el.value);const checks=document.querySelector('.app-theme-contrast');if(checks)checks.outerHTML=contrast(own.appearance);}}
  if(['font','headingFont'].includes(key))delete own.appearance[key+'Axes'];
  return true;
 }
 async function action(button,settings){
  const name=button.dataset.action;
  if(name==='app-theme-use'){if(appThemeChoice(settings,button.dataset.themeId))settings.appTheme=button.dataset.themeId;return true;}
  if(name==='app-theme-new'||name==='app-theme-duplicate'){
   const appearance=activeAppTheme(settings),id='theme-'+crypto.randomUUID().slice(0,8);
   const current=themes(settings).find(item=>item.id===settings.appTheme)?.name??'';
   settings.appThemes=[...(settings.appThemes??[]),{id,name:text('themeCopyName',{name:current}).slice(0,80),appearance}];settings.appTheme=id;return true;
  }
  if(name==='app-theme-delete'){
   const own=(settings.appThemes??[]).find(item=>item.id===settings.appTheme);if(!own)return true;
   if(!await confirmAction(text('themeDeleteConfirm',{name:own.name}),{action:'delete'}))return false;
   settings.appThemes=settings.appThemes.filter(item=>item!==own);settings.appTheme=own.appearance.base;return true;
  }
  return false;
 }
 return {view,paint,input,action};
}
