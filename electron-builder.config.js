import path from 'node:path';
import {installWindowsPayload,verifyWindowsPayload} from './scripts/windows-desktop-payload.js';

const reviewedWindowsPayloads=new Map();
export default {
 appId:'org.observanda.desktop',productName:'Observanda',directories:{app:'desktop',output:'dist/installers'},
 fileOptions:{files:['pdf-renderer.js','pdf-service.js','bootstrap.js','runtime-inventory.js','main.js','policy.js','branding.js','close-guard.js','service-supervisor.js','service-process.js','icon.png','icon-black.png','icon-white.png','package.json'],
  extraResources:process.platform==='win32'?[]:[{from:'dist/desktop-resources',to:'.',filter:['**/*','!**/.package-lock.json']}]},asar:true,nativeModules:{npmRebuild:false},
 forceCodeSigning:true,
 electronFuses:{runAsNode:false,enableCookieEncryption:true,enableNodeOptionsEnvironmentVariable:false,enableNodeCliInspectArguments:false,onlyLoadAppFromAsar:true,enableEmbeddedAsarIntegrityValidation:true,loadBrowserProcessSpecificV8Snapshot:false,grantFileProtocolExtraPrivileges:false},
 beforePack:async({electronPlatformName,appOutDir})=>{
  if(electronPlatformName!==process.platform)throw Error('Prepare and package desktop resources on the matching operating system.');
  await import('./scripts/check-dependencies.js');
  const {verifyDesktopPayload}=await import('./scripts/desktop-payload.js');
  const manifest=await verifyDesktopPayload('dist/desktop-resources',{sourceRoot:'.'});
  for(const name of ['dependencies.cdx.json','build-dependencies.cdx.json','runtimes.json'])if(!manifest.files.some(file=>file.path===name))throw Error('Recreate the desktop payload with dependency and runtime inventories.');
  if(electronPlatformName==='win32')reviewedWindowsPayloads.set(appOutDir,manifest);
  const {updateDesktopIcons}=await import('./scripts/update-icons.js');await updateDesktopIcons({png:true});
 },
 afterPack:async({electronPlatformName,appOutDir})=>{
  if(electronPlatformName==='win32')await installWindowsPayload('dist/desktop-resources',path.join(appOutDir,'resources'),reviewedWindowsPayloads.get(appOutDir));
 },
 afterSign:async({electronPlatformName,appOutDir})=>{
  if(electronPlatformName==='win32'){
   await verifyWindowsPayload(path.join(appOutDir,'resources'),reviewedWindowsPayloads.get(appOutDir));
   reviewedWindowsPayloads.delete(appOutDir);
  }
 },
 win:{target:[{target:'nsis',arch:['x64']}],icon:'desktop/icon.ico',requestedExecutionLevel:'asInvoker'},
 nsis:{oneClick:false,perMachine:false,allowElevation:false,packElevateHelper:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'Observanda',deleteAppDataOnUninstall:false,runAfterFinish:false},
 extraMetadata:{homepage:'https://github.com/Seigr-lab/Observanda'},
 linux:{target:[{target:'deb',arch:['x64']}],icon:'desktop/icon.png',executableName:'observanda',category:'Education',maintainer:'Seigr Lab'},
 // Preserve the packager's Debian defaults, then declare the OS
 // dependencies of GCM's self-contained .NET 10 runtime on Ubuntu 24.04.
 // libsecret is only the client library; credential storage also needs the
 // desktop session's Secret Service provider. Keep secure-store admission.
 // https://learn.microsoft.com/en-us/dotnet/core/install/linux-ubuntu-install
 deb:{depends:['libgtk-3-0','libnotify4','libnss3','libxss1','libxtst6','xdg-utils','libatspi2.0-0','libuuid1','libsecret-1-0','gnome-keyring',
  'ca-certificates','libc6','libgcc-s1','libgssapi-krb5-2','libicu74','libssl3t64','libstdc++6','tzdata','zlib1g']},
 mac:{target:['dmg'],icon:'desktop/icon.png',category:'public.app-category.productivity',sign:{hardenedRuntime:true}},
 dmg:{title:'Observanda',contents:[{x:140,y:180,type:'file'},{x:420,y:180,type:'link',path:'/Applications'}]},
 artifactName:'Observanda-${version}-${os}-${arch}.${ext}',publish:null
};
