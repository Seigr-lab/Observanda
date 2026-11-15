import test from 'node:test';
import assert from 'node:assert/strict';
import {appThemeFromStarting,validAppTheme,validAppThemes,activeAppTheme,appThemeChoice} from '../src/web/app-themes.js';
import {DEFAULT_INTERFACE,validInterface,normalizeInterface} from '../src/web/interface-ui.js';

const own=(id,overrides={})=>({id,name:'Night lab',appearance:{...appThemeFromStarting('studio'),background:'#14161c',surface:'#1d212a',text:'#e9e6df',...overrides}});

test('an author theme starts from a starting theme and keeps every token the app uses',()=>{
 const theme=appThemeFromStarting('research');
 assert.equal(theme.base,'research');
 for(const key of ['accent','background','surface','text','muted','border','font','headingFont','radius','density'])assert.ok(Object.hasOwn(theme,key),key);
 assert.equal(validAppTheme(theme),true);
});

test('themes with unknown fields, colours outside hex or out-of-range shapes are refused',()=>{
 assert.equal(validAppTheme({...appThemeFromStarting('research'),accent:'red'}),false);
 assert.equal(validAppTheme({...appThemeFromStarting('research'),radius:40}),false);
 assert.equal(validAppTheme({...appThemeFromStarting('research'),script:'x'}),false);
 assert.equal(validAppTheme({...appThemeFromStarting('research'),base:'unknown'}),false);
 assert.equal(validAppThemes([own('night'),own('night')]),false,'duplicate ids');
 assert.equal(validAppThemes([own('research')]),false,'a starting theme id cannot be reused');
 assert.equal(validAppThemes([{...own('night'),name:' '}]),false,'a theme needs a name');
 assert.equal(validAppThemes(Array.from({length:41},(_,i)=>own('t'+i))),false,'at most 40 themes');
});

test('the active theme is the chosen own theme, falling back to a starting theme',()=>{
 const settings={...normalizeInterface(DEFAULT_INTERFACE),appThemes:[own('night')],appTheme:'night'};
 assert.equal(activeAppTheme(settings).background,'#14161c');
 assert.equal(activeAppTheme({...settings,appTheme:'studio'}).background,appThemeFromStarting('studio').background);
 assert.equal(appThemeChoice(settings,'night'),true);assert.equal(appThemeChoice(settings,'missing'),false);
});

test('saved app settings accept own themes and refuse a choice that does not exist',()=>{
 const settings={...structuredClone(DEFAULT_INTERFACE),appThemes:[own('night')],appTheme:'night'};
 assert.equal(validInterface(settings),true);
 assert.equal(validInterface({...settings,appTheme:'missing'}),false);
 assert.equal(validInterface({...settings,appThemes:[own('night',{accent:'#12'})]}),false);
 const legacy=structuredClone(DEFAULT_INTERFACE);delete legacy.appThemes;
 assert.equal(validInterface(legacy),true,'settings saved before own themes still load');
});
