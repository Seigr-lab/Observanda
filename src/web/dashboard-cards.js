import {renderFigure} from './figure-renderer.js';
export const cardIcons={
 records:'<path d="M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4"/>',
 projects:'<path d="M3 6h7l2 2h9v12H3zM3 6V4h7l2 2"/>',
 figures:'<path d="M4 3v17h17M7 15l4-5 4 2 5-7"/>',
 contributors:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>',
 files:'<path d="M8 3h9l3 3v14H8zM4 7v15h12M13 3v5h7"/>',
 media:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="2"/><path d="m3 17 6-5 4 4 3-3 5 5"/>',
 samples:'<path d="M8 3h8M10 3v7L5 19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2l-5-9V3M8 15h8"/>',
 laboratory:'<path d="M7 3h10M9 3v8l-5 8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2l-5-8V3M8 15h8"/>',
 website:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 6 5 12 0 18-5-6-5-12 0-18"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
 grip:'<circle cx="9" cy="6" r=".8"/><circle cx="15" cy="6" r=".8"/><circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/><circle cx="9" cy="18" r=".8"/><circle cx="15" cy="18" r=".8"/>',
 resize:'<path d="M10 20h10V10M14 20l6-6M6 20 20 6"/>'
};
export const cardIcon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${cardIcons[name]??cardIcons.records}</svg>`;

let figureInstance=0;
export const chartGraphic=figure=>renderFigure(figure,{idPrefix:'dashboard-'+(++figureInstance)});
