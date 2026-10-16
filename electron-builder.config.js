export default {
 appId:'org.observanda.desktop',productName:'Observanda',directories:{app:'desktop',output:'dist/installers'},
 files:['main.js','policy.js','branding.js','close-guard.js','locales/**/*.json','icon.png','icon-black.png','icon-white.png','package.json'],asar:true,npmRebuild:false,
 extraResources:[{from:'dist/desktop-resources',to:'.',filter:['**/*','!**/.package-lock.json']}],
 beforePack:async()=>{
  const {verifyDesktopPayload}=await import('./scripts/desktop-payload.js');await verifyDesktopPayload('dist/desktop-resources',{sourceRoot:'.'});
  const {updateDesktopIcons}=await import('./scripts/update-icons.js');await updateDesktopIcons({png:true});
 },
 win:{target:[{target:'nsis',arch:['x64']}],icon:'desktop/icon.ico',requestedExecutionLevel:'asInvoker'},
 nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'Observanda',deleteAppDataOnUninstall:false,runAfterFinish:false},
 mac:{target:['dmg'],icon:'desktop/icon.png',category:'public.app-category.productivity',hardenedRuntime:true},
 dmg:{title:'Observanda',contents:[{x:140,y:180,type:'file'},{x:420,y:180,type:'link',path:'/Applications'}]},
 artifactName:'Observanda-${version}-${os}-${arch}.${ext}',publish:null
};
