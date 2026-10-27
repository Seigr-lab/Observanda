import './i18n/catalogues/websiteFeeds.js';
import {t} from './i18n/index.js';
import {defaultFeed,feedOrders} from './website-feed-model.js';

export function websiteFeedFields(section,{esc,field,option}){
 const tr=key=>t('websiteFeeds',key),feed=section.feed??defaultFeed(section.kind);
 const toggle=(key,checked)=>'<label class="checkbox"><input type="checkbox" data-block-feed="'+section.id+'" data-key="'+key+'"'+(checked?' checked':'')+'><span>'+esc(tr(key))+'</span></label>';
 return '<fieldset class="website-feed-settings"><legend>'+esc(tr('pages'))+'</legend>'+toggle('enable',!!section.feed)+(!section.feed?'':
  field(tr('pageSize'),'<input type="number" min="1" step="1" data-block-feed="'+section.id+'" data-key="pageSize" value="'+feed.pageSize+'">')+
  field(tr('initialOrder'),'<select data-block-feed="'+section.id+'" data-key="order">'+feedOrders(section.kind).map(value=>option(value,tr(value),feed.order)).join('')+'</select>')+
  ['navigation','visitorOrder','visitorFilters','visitorView'].map(key=>toggle(key,feed[key])).join('')+
  '<details><summary>'+esc(tr('labels'))+'</summary>'+Object.keys(feed.labels).map(key=>field(tr(key),'<input data-block-feed="'+section.id+'" data-feed-label="'+key+'" maxlength="160" placeholder="'+esc(tr(key))+'" value="'+esc(feed.labels[key])+'">')).join('')+'</details>')+'</fieldset>';
}
export function changeWebsiteFeed(section,element){
 if(element.dataset.key==='enable'){if(element.checked)section.feed=defaultFeed(section.kind);else delete section.feed;return true;}
 const feed=section.feed;if(!feed)return false;
 if(element.dataset.feedLabel)feed.labels[element.dataset.feedLabel]=element.value;
 else feed[element.dataset.key]=element.type==='checkbox'?element.checked:element.dataset.key==='pageSize'?Number(element.value):element.value;
 return false;
}
