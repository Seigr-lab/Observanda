import {contrastRatio} from './themes.js';

// Application identity is independent of the user's publication branding.
export const applicationMark='<span class="app-logo" aria-hidden="true"><img class="app-logo-black" src="/observanda-black.svg" width="31" height="31" alt=""><img class="app-logo-white" src="/observanda-white.svg" width="31" height="31" alt=""></span>';

export function applyApplicationBrand(appearance){
 for(const context of ['surface','background']){
  const white=contrastRatio(appearance[context],'#ffffff')>contrastRatio(appearance[context],'#000000');
  document.documentElement.style.setProperty('--app-logo-'+context+'-black',white?'none':'block');
  document.documentElement.style.setProperty('--app-logo-'+context+'-white',white?'block':'none');
 }
}
