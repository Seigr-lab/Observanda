import {t} from './i18n/index.js';
import {pdfPageMasterDefaults,PDF_PAGE_NUMBER_STYLES} from './pdf-page-master-model.js';
const tr=(key,parameters)=>t('pdfEditor',key,parameters);
export function pdfPageMasterFields(layout,owner,{esc}){
 const enabled=layout.pageMaster!==undefined,value=layout.pageMaster??pdfPageMasterDefaults(layout),attrs=key=>'data-pdf-layout="'+esc(owner)+'" data-key="master.'+key+'"',field=(key,input)=>'<label class="field">'+esc(tr(key))+input+'</label>',checkbox=(key,checked,label=key)=>field(label,'<input type="checkbox" '+attrs(key)+(checked?' checked':'')+'>');
 const number=(key,min,max,step=1)=>field(key,'<input type="number" '+attrs(key)+' min="'+min+'" max="'+max+'" step="'+step+'" value="'+esc(value[key])+'">');
 return '<details data-pdf-page-master><summary>'+esc(tr('pageMaster'))+'</summary>'+checkbox('enabled',enabled,'pageMasterEnabled')+'<p>'+esc(tr('pageMasterHint',{page:'{page}',pages:'{pages}',section:'{section}'}))+'</p><fieldset data-pdf-master-controls'+(enabled?'':' disabled')+'>'+checkbox('facingPages',value.facingPages)+number('gutterMm',0,100,.1)+checkbox('firstPageHeader',value.firstPageHeader)+checkbox('firstPageFooter',value.firstPageFooter)+field('numberStyle','<select '+attrs('numberStyle')+'>'+PDF_PAGE_NUMBER_STYLES.map((style,index)=>'<option value="'+style+'"'+(value.numberStyle===style?' selected':'')+'>'+esc(tr(['decimal','lowerRoman','upperRoman'][index]))+'</option>').join('')+'</select>')+(owner==='section'?'':number('numberStart',1,9999))+['header','footer'].map(group=>['left','center','right'].map(side=>field(group+side[0].toUpperCase()+side.slice(1),'<input '+attrs(group+'.'+side)+' maxlength="240" value="'+esc(value[group][side])+'">')).join('')).join('')+'</fieldset></details>';
}
export function changePdfPageMaster(layout,key,value){
 if(typeof key!=='string'||!key.startsWith('master.'))return false;
 const selected=key.slice(7);
 if(selected==='enabled'){if(value)layout.pageMaster??=pdfPageMasterDefaults(layout);else delete layout.pageMaster;return true;}
 if(!layout.pageMaster)return false;
 if(['facingPages','firstPageHeader','firstPageFooter'].includes(selected))layout.pageMaster[selected]=value===true;
 else if(['gutterMm','numberStart'].includes(selected))layout.pageMaster[selected]=Number(value);
 else if(selected==='numberStyle')layout.pageMaster.numberStyle=value;
 else{const match=/^(header|footer)\.(left|center|right)$/.exec(selected);if(!match)return false;layout.pageMaster[match[1]][match[2]]=value;}
 return true;
}
