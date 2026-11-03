// The starter is saved as ordinary site CSS. Authors can change it in the
// visual editor or replace it completely, just like an imported stylesheet.
export const starterStyles=`:root {
  color-scheme: light;
  --page-text: #193337;
  --page-background: #f6f8f6;
  --page-surface: #ffffff;
  --page-border: #c8d6cf;
  --accent: #08635a;
  --section-space: 2.5rem;
  --card-gap: 1rem;
  --card-padding: clamp(1rem, 3vw, 2rem);
  --corner-radius: .5rem;
}
:where(*, *::before, *::after) { box-sizing: border-box; }
:where(body) {
  margin: 0;
  border-block-start: .32rem solid var(--accent);
  background: var(--page-background);
  color: var(--page-text);
  font: 1rem/1.6 system-ui, sans-serif;
}
:where(body > header, body > main, body > footer) {
  inline-size: min(100% - 3rem, 70rem);
  margin-inline: auto;
}
:where(body > main) { padding-block: clamp(2rem, 5vw, 4rem); }
:where(h1, h2, h3, h4) { line-height: 1.2; text-wrap: balance; }
:where(main > h1) {
  margin: 0 0 1.2em;
  padding-block-end: .45em;
  border-block-end: 1px solid var(--page-border);
  font: 600 clamp(2.2rem, 4vw, 3.6rem)/1.12 Georgia, serif;
  letter-spacing: -.025em;
}
:where(p, li) { overflow-wrap: anywhere; }
:where(main > p, .website-feed-item p) { max-inline-size: 76ch; }
:where(a) { color: var(--accent); text-underline-offset: .2em; }
:where(a, button, input, summary):focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
:where(img, svg, video, audio) { max-inline-size: 100%; }
:where(img, video) { block-size: auto; }
:where(figure) { margin: 1.5rem 0; }
:where(figcaption) { font-size: .9em; }
:where(table) { border-collapse: collapse; }
:where(th, td) { padding: .5em .75em; border-block-end: 1px solid var(--page-border); text-align: start; }
:where(pre) { max-inline-size: 100%; overflow: auto; }
:where(.website-feed > h2) { margin-block: 0 1em; }
:where(.website-feed[data-template="full"] > .website-feed-items > .website-feed-item) {
  padding: var(--card-padding);
  border: 1px solid var(--page-border);
  border-radius: var(--corner-radius);
  background: var(--page-surface);
}
:where(.website-feed-nav a) { font-weight: 600; }
@media print {
  body { background: white; border: 0; }
  body > main { inline-size: 100%; padding: 0; }
  .website-feed-nav { display: none; }
}
`;

export function starterPage({title,stylesheet,language='en'},escape){
 let lang='en';
 if(typeof language==='string'&&language.length<=64){
  try{[lang]=Intl.getCanonicalLocales(language);}catch{ /* A document with no declared language uses English. */ }
 }
 const heading=escape(title);
 return '<!doctype html><html lang="'+escape(lang??'en')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+heading+'</title><link rel="stylesheet" href="'+escape(stylesheet)+'"></head><body><main><h1>'+heading+'</h1></main></body></html>';
}
