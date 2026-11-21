import {enhancePublicFeeds} from './web/public-feeds.js';

export const PUBLIC_FEEDS_SCRIPT='('+enhancePublicFeeds.toString()+')(document,window,window.fetch.bind(window));\n';
export const feedFilePath=name=>/^(?:(?:projects|notebooks|entries|pages)\/)?feed-[a-f0-9]{64}-\d+\.html$/.test(name);
