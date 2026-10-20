import {t} from './i18n/index.js';
const text=(key,args)=>t('recordContent',key,args);
export function recordHeaderControls(name,page,esc,busy){
 if(!page||page.total<=4)return '';
 const button=(label,action,disabled)=>'<button type="button" class="button" data-action="content-collection-'+action+'" data-collection="'+name+'"'+(busy||disabled?' disabled':'')+'>'+esc(text(label))+'</button>';
 return '<nav class="record-section-navigation" data-record-collection="'+name+'" aria-label="'+esc(text('collectionNavigation',{name:name.startsWith('preparation:')?t('attempts',name.split(':')[2]):text('collection_'+name)}))+'"><span role="status">'+esc(text('collectionRange',{first:page.offset+1,last:page.offset+page.count,total:page.total}))+'</span><div class="inline-actions">'+button('collectionPrevious','previous',page.offset===0)+button('collectionNext','next',page.offset+page.count>=page.total)+'</div><label>'+esc(text('collectionGoTo'))+' <input type="number" data-collection-position="'+name+'" min="1" max="'+page.total+'" value="'+(page.offset+1)+'" required></label>'+button('go','go',false)+'</nav>';
}
