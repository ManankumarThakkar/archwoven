type Kind = 'architecture' | 'sequence' | 'er' | 'detail';

/** Small editorial illustrations of the product's four supported views. */
export function ViewIllustration({ kind }: { kind: Kind }) {
  return <svg viewBox="0 0 260 150" fill="none" aria-hidden="true" focusable="false">
    {kind === 'architecture' && <><path d="M65 51v28h130V51M130 79v27" stroke="currentColor" /><rect x="36" y="22" width="58" height="30" rx="6" /><rect x="166" y="22" width="58" height="30" rx="6" /><rect x="101" y="106" width="58" height="30" rx="6" /><circle cx="130" cy="79" r="4" className="lp-illustration-dot" /></>}
    {kind === 'sequence' && <><path d="M55 47v87M130 47v87M205 47v87" stroke="currentColor" strokeDasharray="3 5" />{[32, 107, 182].map(x => <rect key={x} x={x} y="18" width="46" height="28" rx="6" />)}<path d="M55 65h75l-5-4m5 4-5 4M130 88h75l-5-4m5 4-5 4M205 112h-75l5-4m-5 4 5 4" stroke="currentColor" /></>}
    {kind === 'er' && <><rect x="25" y="29" width="78" height="94" rx="6" /><rect x="157" y="29" width="78" height="94" rx="6" /><path d="M25 56h78M157 56h78M103 77h54m-8-7 8 7-8 7M41 72h26m-26 16h45M173 72h26m-26 16h45" stroke="currentColor" /><circle cx="43" cy="42" r="3" className="lp-illustration-dot" /><circle cx="175" cy="42" r="3" className="lp-illustration-dot" /></>}
    {kind === 'detail' && <><rect x="35" y="15" width="190" height="124" rx="12" strokeDasharray="4 5" /><rect x="60" y="48" width="57" height="34" rx="6" /><rect x="143" y="93" width="57" height="29" rx="6" /><path d="M117 65h55v28M51 32h49" stroke="currentColor" /><circle cx="172" cy="65" r="4" className="lp-illustration-dot" /></>}
  </svg>;
}
