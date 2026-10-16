import path from 'node:path';

export function windowIcon(directory,dark){
 return path.join(directory,dark?'icon-white.png':'icon-black.png');
}

export function followWindowTheme(window,nativeTheme,directory){
 const update=()=>{if(!window.isDestroyed())window.setIcon(windowIcon(directory,nativeTheme.shouldUseDarkColors));};
 nativeTheme.on('updated',update);
 window.once('closed',()=>nativeTheme.removeListener('updated',update));
 update();
}
