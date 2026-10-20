import {websiteContext} from './website-context.js';
import { STARTING_THEMES, fontStack, startingAppearance, sameAppearance, contrastRatio } from './themes.js';
import {fontSelect,axisControls} from './font-picker.js';
import {variationCSS} from './font-catalogue.js';
import {t} from './i18n/index.js';
import {applyApplicationBrand} from './app-brand.js';
import {enhanceAppearanceReading} from './appearance-preview-reading.js';
const message=(key,parameters)=>t('appearance',key,parameters);

export function appearanceUI({ fontLibrary, textControls, state, esc, field, option, dirty, save, render, showDialog, notify, preview, previewPages }) {
  let undo = null,context=null;
  const sync=()=>{const next=websiteContext(state);if(next!==context){undo=null;context=next;}};
  const text=(key,parameters)=>esc(message(key,parameters));
  const active = () => state.book.themes.find(t => t.id === state.book.activeThemeId);
  const chosen = () => state.book.themes.find(t => t.id === document.querySelector('#saved-theme')?.value);
  function applyToApp() {
    const a = (!state.newWorkspace && state.book?.appearance) || startingAppearance('research');
    const values = { accent: a.accent, background: a.background, surface: a.surface, text: a.text, muted: a.muted, border: a.border,
      radius: a.radius + 'px', font: fontStack(a.font), heading: fontStack(a.headingFont), axes:variationCSS(a.fontAxes), 'heading-axes':variationCSS(a.headingFontAxes), weight:a.fontAxes?.wght??400, 'heading-weight':a.headingFontAxes?.wght??600,
      'on-accent': contrastRatio(a.accent, '#ffffff') >= contrastRatio(a.accent, '#17283f') ? '#ffffff' : '#17283f' };
    for (const [key, value] of Object.entries(values)) document.documentElement.style.setProperty('--ui-' + key, value);
    document.documentElement.dataset.theme = a.theme;
    applyApplicationBrand(a);
    document.documentElement.dataset.density = a.density;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.background);
  }
  function status() {
    const preset = active(), a = state.book.appearance;
    return text(preset?(sameAppearance(a,preset.appearance)?'statusSaved':'statusModified'):(sameAppearance(a,STARTING_THEMES[a.theme].appearance)?'statusStarting':'statusCustomized'),{name:preset?.name??message(a.theme+'Name')});
  }
  function refresh() {
    applyToApp();
    const label = document.querySelector('#theme-status'); if (label) label.innerHTML = status();
    const update = document.querySelector('[data-action="theme-update"]'); if (update) update.disabled = !active() || sameAppearance(state.book.appearance, active().appearance);
    const undoButton = document.querySelector('[data-action="theme-undo"]'); if (undoButton) undoButton.disabled = !undo;
    for (const button of document.querySelectorAll('[data-action="theme-start"]')) button.setAttribute('aria-pressed', String(!active() && sameAppearance(state.book.appearance, STARTING_THEMES[button.dataset.theme].appearance)));
    for (const control of document.querySelectorAll('[data-appearance]')) {
      const output = document.querySelector(`[data-value-for="${control.dataset.appearance}"]`);
      if (output) output.textContent = control.value + (control.dataset.appearance === 'width' || control.dataset.appearance === 'radius' || control.dataset.appearance === 'fontSize' ? ' px' : '');
    }
  }
  const remember = () => { if (!undo) undo = { appearance: structuredClone(state.book.appearance), id: state.book.activeThemeId }; };
  function replace(appearance, id) {
    undo = { appearance: structuredClone(state.book.appearance), id: state.book.activeThemeId };
    state.book.appearance = structuredClone(appearance); state.book.activeThemeId = id; dirty(); render();
  }
  function view() {
    sync();
    const a = state.book.appearance, selected = active();
    const range = (key, label, min, max, step = 1) => field(`${label} <output data-value-for="${key}">${a[key]}${['width','radius','fontSize'].includes(key) ? ' px' : ''}</output>`, `<input type="range" min="${min}" max="${max}" step="${step}" data-appearance="${key}" value="${a[key]}">`);
    return `<div class="page-heading"><div><h1>${text('title')}</h1></div><button class="button primary" data-action="theme-save-as">${text('saveAs')}</button></div>
      <div class="workspace-tabs"><button class="button" data-action="branding" data-target="home">${text('branding')}</button><button class="button" data-action="interface-layout">${text('appLayout')}</button></div>
      <section class="panel app-header-controls"><h2>${text('appHeader')}</h2>${textControls.headerControls()}</section><div class="theme-starters">${Object.entries(STARTING_THEMES).map(([id, t]) => `<button class="theme-tile theme-tile-${id}" data-action="theme-start" data-theme="${id}" aria-pressed="${!selected && sameAppearance(a,t.appearance)}"><span class="theme-mini" aria-hidden="true"><span class="mini-rail"></span><span class="mini-sheet"><b>Aa</b><span></span><span></span><i></i></span></span><span class="theme-tile-copy"><strong>${text(id+'Name')}</strong><small>${text(id+'Description')}</small></span><span class="theme-pick" aria-hidden="true">${text('useTheme')}</span></button>`).join('')}</div>
      <div class="appearance-layout"><div class="design-controls"><section class="panel interface-controls"><h2>${text('appText')}</h2>${textControls.controls()}</section><section class="panel theme-library"><h2>${text('themes')}</h2>${state.book.themes.length ? `${field(message('savedTheme'), `<select id="saved-theme">${state.book.themes.map(t => option(t.id,t.name,selected?.id ?? state.book.themes[0].id)).join('')}</select>`)}<div class="inline-actions"><button class="button" data-action="theme-apply">${text('apply')}</button><button class="button" data-action="theme-rename">${text('rename')}</button><button class="button" data-action="theme-delete">${text('delete')}</button></div>` : `<p class="muted">${text('emptyThemes')}</p>`}<p id="theme-status" class="theme-status">${status()}</p><div class="inline-actions"><button class="button" data-action="theme-update" ${!selected || sameAppearance(a,selected.appearance) ? 'disabled' : ''}>${text('updateTheme')}</button><button class="button" data-action="theme-undo" ${undo ? '' : 'disabled'}>${text('undo')}</button></div></section>
      <section class="panel"><h2>${text('palette')}</h2><div class="palette-grid">${[['accent',message('accent')],['background',message('background')],['surface',message('surface')],['text',message('text')],['muted',message('muted')],['border',message('border')]].map(([key,label]) => field(label,`<input data-appearance="${key}" type="color" value="${a[key]}">`)).join('')}</div></section>
      <section class="panel"><h2>${text('typography')}</h2>${['headingFont','font'].map(key=>field(key==='font'?message('font'):message('headingFont'),fontSelect(`data-appearance="${key}"`,a[key]))+`<div data-appearance-axes="${key}">${axisControls(a[key],a[key+'Axes'],`data-appearance-axis="${key}"`)}</div>`).join('')}<p class="muted">${text('offlineFonts')}</p>${range('fontSize',message('fontSize'),14,22)}${range('lineHeight',message('lineHeight'),1.4,2,0.05)}</section>${fontLibrary.view()}
      <section class="panel"><h2>${text('layoutTitle')}</h2>${field(message('density'), `<select data-appearance="density">${option('comfortable',message('comfortable'),a.density)}${option('compact',message('compact'),a.density)}</select>`)}${range('radius',message('radius'),0,24)}${range('width',message('width'),640,1100,20)}${field(message('layout'), `<select data-appearance="layout">${option('grid',message('grid'),a.layout)}${option('list',message('list'),a.layout)}</select>`)}${field(message('header'), `<select data-appearance="header">${option('band',message('band'),a.header)}${option('plain',message('plain'),a.header)}</select>`)}<p class="muted">${text('layoutNote')}</p></section></div>
      <section class="design-preview"><div class="preview-toolbar"><strong>${text('preview')}</strong><div class="inline-actions"><button class="button" data-action="theme-preview-expand">${text('expand')}</button><button class="button" data-action="theme-preview-width" data-width="full" aria-pressed="${state.designWidth !== 'phone'}">${text('desktop')}</button><button class="button" data-action="theme-preview-width" data-width="phone" aria-pressed="${state.designWidth === 'phone'}">${text('phone')}</button></div></div><div class="design-source-controls">${field(message('previewContent'),`<select id="design-source">${option('examples',message('examples'),state.designEffectiveSource??'examples')}${option('website',message('website'),state.designEffectiveSource)}</select>`)}${field(message('previewPage'),`<select id="design-page"><option>${text('loadingPage')}</option></select>`)}</div><div id="design-page-paging" class="inline-actions" hidden><button type="button" class="button" data-action="theme-preview-previous-pages" disabled>${text('previousPages')}</button><button type="button" class="button" data-action="theme-preview-next-pages" disabled>${text('nextPages')}</button></div><p id="design-preview-note" class="preview-label" role="status">${text('loadingPreview')}</p><button class="button" type="button" data-action="theme-preview-retry" hidden>${text('retryPreview')}</button><div class="preview-canvas ${state.designWidth === 'phone' ? 'phone-preview' : ''}"><iframe id="design-preview" class="preview-frame" title="${text('previewTitle')}" sandbox="allow-same-origin"></iframe></div></section></div>`;
  }
  async function action(button) {
    sync();
    const name = button.dataset.action;
    if (!name?.startsWith('theme-')) return false;
    if (name === 'theme-preview-retry') { preview(); return true; }
    if (name === 'theme-preview-next-pages'||name === 'theme-preview-previous-pages') { await previewPages(name==='theme-preview-next-pages'?'next':'previous');return true; }
    if (name === 'theme-preview-expand') {
      const frame=document.querySelector('#design-preview');let url=frame?.src;
      try{const current=frame?.contentWindow.location.href;if(current&&new URL(current).origin===location.origin)url=current;}catch{/* A detached frame has no current page. */}
      if(url){
        showDialog(`<div class="expanded-preview"><div class="preview-toolbar"><h2 id="dialog-title">${text('preview')}</h2><button class="button" data-action="close-dialog">${text('closePreview')}</button></div><iframe title="${text('expandedTitle')}" src="${esc(url)}" sandbox="allow-same-origin"></iframe></div>`);
        const expanded=document.querySelector('.expanded-preview iframe');expanded.onload=()=>enhanceAppearanceReading(expanded);
      }
    }
    if (name === 'theme-start') replace(startingAppearance(button.dataset.theme), null);
    if (name === 'theme-apply') { const preset = chosen(); if (preset) replace(preset.appearance, preset.id); }
    if (name === 'theme-undo' && undo) { const previous = undo; undo = null; state.book.appearance = previous.appearance; state.book.activeThemeId = state.book.themes.some(t => t.id === previous.id) ? previous.id : null; dirty(); render(); }
    if (name === 'theme-preview-width') { state.designWidth = button.dataset.width; render(); }
    if (name === 'theme-save-as' || name === 'theme-rename') {
      const preset = name === 'theme-rename' ? chosen() : null;
      if (name === 'theme-save-as' && state.book.themes.length >= 50) { notify(message('themeLimit'), true); return true; }
      showDialog(`<form id="theme-name-form" data-id="${preset?.id ?? ''}"><h2 id="dialog-title">${preset ? message('renameTheme') : message('saveThemeDialog')}</h2>${field(message('themeName'),`<input name="name" required maxlength="80" value="${esc(preset?.name ?? '')}" placeholder="${text('namePlaceholder')}" autocomplete="off">`)}<p class="muted">${text('nameNote')}</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${text('cancel')}</button><button type="submit" class="button primary">${preset ? message('renameTheme') : message('saveTheme')}</button></div></form>`);
      document.querySelector('#theme-name-form input').focus();
    }
    if (name === 'theme-delete') {
      const preset = chosen();
      if (preset && confirm(message('deleteConfirm',{name:preset.name}))) {
        state.book.themes = state.book.themes.filter(t => t.id !== preset.id);
        if (state.book.activeThemeId === preset.id) state.book.activeThemeId = null;
        dirty(); render(); await save(); notify(message('deleted'));
      }
    }
    if (name === 'theme-update' || name === 'theme-save-appearance') {
      button.disabled = true;
      try {
        if (name === 'theme-update' && active()) { active().appearance = structuredClone(state.book.appearance); dirty(); }
        await save(); refresh(); notify(state.dirty ? message('newerEdits') : name === 'theme-update' ? message('updated') : message('savedAppearance'));
      } finally { button.disabled = false; refresh(); }
    }
    return true;
  }
  function input(el) {
    sync();
    if(el.dataset.appearanceAxis){if(!el.checkValidity())return true;remember();const key=el.dataset.appearanceAxis+'Axes',axes=state.book.appearance[key]??={},tag=el.dataset.fontAxis;if(el.value==='')delete axes[tag];else axes[tag]=Number(el.value);dirty();refresh();preview();return true;}
    if(el.id==='design-source'){state.designSource=el.value;state.designPage=null;preview();return true;}
    if(el.id==='design-page'){state.designPage=el.value;const result=state.designResult;if(result)document.querySelector('#design-preview').contentWindow.location.replace(result.baseUrl+el.value);return true;}
    if (!el.dataset.appearance) return false;
    remember(); const key = el.dataset.appearance;
    state.book.appearance[key] = ['width','fontSize','lineHeight','radius'].includes(key) ? Number(el.value) : el.value;
    if(['font','headingFont'].includes(key)){delete state.book.appearance[key+'Axes'];const controls=document.querySelector(`[data-appearance-axes="${key}"]`);if(controls)controls.innerHTML=axisControls(el.value,{},`data-appearance-axis="${key}"`);}
    dirty(); refresh(); preview(); return true;
  }
  async function submit(form, data) {
    if (form.id !== 'theme-name-form') return false;
    const name = data.get('name').trim(); if (!name) { notify(message('nameRequired'), true); return true; }
    const preset = state.book.themes.find(t => t.id === form.dataset.id);
    if (preset) preset.name = name;
    else {
      if (state.book.themes.length >= 50) return true;
      const id = crypto.randomUUID(); state.book.themes.push({ id, name, appearance: structuredClone(state.book.appearance) }); state.book.activeThemeId = id;
      // Retrying a failed save updates this preset rather than creating a duplicate.
      form.dataset.id = id;
    }
    dirty(); await save(); document.querySelector('#dialog').close(); render(); notify(state.dirty ? message('savedNewer') : message('savedThemeNotice')); return true;
  }
  return { view, action, input, submit, applyToApp, refresh, resetUndo:()=>{undo=null;} };
}
