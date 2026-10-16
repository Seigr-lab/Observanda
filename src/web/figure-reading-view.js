import {bookText} from './book-messages.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Native controls work in the app, retained revisions and offline exports.
// Enlargement reuses the same graphic and never changes the saved figure.
export function figureReadingView(visual,title){
 return `<div class="figure-reading-view"><label class="figure-reading-control"><input type="checkbox"> <span>${esc(bookText('enlargeFigure'))}</span></label><p class="figure-reading-hint">${esc(bookText('panFigure'))}</p><div class="figure-reading-viewport" role="region" aria-label="${esc(bookText('figureViewport')+' '+title)}" tabindex="0">${visual}</div></div>`;
}
