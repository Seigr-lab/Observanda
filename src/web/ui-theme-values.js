// Editor marks drawn inside a website page (selection outlines, drop lines)
// belong to the app, not the website, so they follow the author's app theme.
// The page cannot see the app's variables; this reads their current values.
const fallback={accent:'#2457d6',surface:'#ffffff',text:'#17283f','on-accent':'#ffffff',font:'system-ui,sans-serif'};
export function uiTheme(name){
 const value=typeof document==='undefined'?'':getComputedStyle(document.documentElement).getPropertyValue('--ui-'+name).trim();
 return value||fallback[name]||'';
}
