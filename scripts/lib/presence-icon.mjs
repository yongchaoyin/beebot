/** Fixed BeeBot application identity. Bot avatar choices are deliberately not
 * imported here: changing their catalog must not rebrand the application icon.
 * Keep icon generation deterministic and the existing checked SVG unchanged. */
export function presenceIconSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect x="24" y="24" width="976" height="976" rx="216" fill="#F6F7F8"/>
  <g transform="translate(128 104) scale(12)">
    <path d="M18 10C9 10 5 19 5 32s5 23 17 23h20c12 0 17-9 17-22S54 10 43 10Z" fill="#ADC3EA"/>
    <path d="M15 24q1-6 7-7" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2" stroke-linecap="round"/>
    <rect x="21" y="28" width="4.5" height="7" rx="2.25" fill="#273347"/>
    <rect x="38.5" y="28" width="4.5" height="7" rx="2.25" fill="#273347"/>
    <path d="M29 41q3 3 6 0" fill="none" stroke="#273347" stroke-width="1.7" stroke-linecap="round"/>
  </g>
</svg>
`;
}
