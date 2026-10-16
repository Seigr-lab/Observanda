import messages from './locales/en/book.json' with {type:'json'};
export const bookText=key=>messages[key]??key;
