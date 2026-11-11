// The only script a site region adds to a published page: regions that
// collapse on phones start open (complete without scripts) and close on
// narrow screens, opening again when the screen widens.
export const PUBLIC_REGIONS_SCRIPT=`(()=>{const narrow=matchMedia('(max-width: 48rem)');const sync=()=>{for(const toggle of document.querySelectorAll('[data-website-region-toggle]'))toggle.open=!narrow.matches;};sync();narrow.addEventListener('change',sync);})();
`;
