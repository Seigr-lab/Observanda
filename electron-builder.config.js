export default {
 appId:'org.observanda.desktop',productName:'Observanda',directories:{app:'desktop',output:'dist/installers'},
 files:['pdf-renderer.js','pdf-service.js','main.js','policy.js','branding.js','close-guard.js','locales/**/*.json','icon.png','icon-black.png','icon-white.png','package.json'],asar:true,npmRebuild:false,
 extraResources:[{from:'dist/desktop-resources',to:'.',filter:['**/*','!**/.package-lock.json']}],
 beforePack:async()=>{
  const {verifyDesktopPayload}=await import('./scripts/desktop-payload.js');await verifyDesktopPayload('dist/desktop-resources',{sourceRoot:'.'});
  const {updateDesktopIcons}=await import('./scripts/update-icons.js');await updateDesktopIcons({png:true});
 },
 win:{target:[{target:'nsis',arch:['x64']}],icon:'desktop/icon.ico',requestedExecutionLevel:'asInvoker'},
 nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'Observanda',deleteAppDataOnUninstall:false,runAfterFinish:false},
 extraMetadata:{homepage:'https://github.com/Seigr-lab/Observanda'},
 linux:{target:[{target:'deb',arch:['x64']}],icon:'desktop/icon.png',executableName:'observanda',category:'Education',maintainer:'Seigr Lab'},
 // Preserve electron-builder 26.15.3's Debian defaults, then declare the OS
 // dependencies of GCM's self-contained .NET 10 runtime on Ubuntu 24.04.
 // libsecret is only the client library; credential storage also needs the
 // desktop session's Secret Service provider. Keep secure-store admission.
 // https://learn.microsoft.com/en-us/dotnet/core/install/linux-ubuntu-install
 deb:{depends:['libgtk-3-0','libnotify4','libnss3','libxss1','libxtst6','xdg-utils','libatspi2.0-0','libuuid1','libsecret-1-0','gnome-keyring',
  'ca-certificates','libc6','libgcc-s1','libgssapi-krb5-2','libicu74','libssl3t64','libstdc++6','tzdata','zlib1g']},
 mac:{target:['dmg'],icon:'desktop/icon.png',category:'public.app-category.productivity',hardenedRuntime:true},
 dmg:{title:'Observanda',contents:[{x:140,y:180,type:'file'},{x:420,y:180,type:'link',path:'/Applications'}]},
 artifactName:'Observanda-${version}-${os}-${arch}.${ext}',publish:null
};
