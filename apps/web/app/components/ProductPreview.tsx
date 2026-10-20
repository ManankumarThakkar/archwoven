'use client';

import { useEffect, useRef, useState } from 'react';

const steps = [
  { title: 'Describe', heading: 'Start with a little context.', text: '“A catalog app: customers call an API gateway; a catalog service serves items from PostgreSQL.”', note: 'A description becomes components and connections. This recorded example makes no AI calls.' },
  { title: 'Explore', heading: 'Every connection tells a story.', text: 'API Gateway → Catalog Service', note: 'This connection is inferred from context. Inspect its provenance and decide whether it belongs in your system.' },
  { title: 'Keep', heading: 'Take the picture with you.', text: 'A design discussion. A project handoff. Your next README.', note: 'The workspace exports SVG, PNG and JSON. Try the recorded SVG below without generating anything.' },
];

const mapLayouts = {
  wide: {
    viewBox: '0 0 890 340',
    nodes: [[30, 125], [250, 125], [470, 125], [690, 125]],
    links: [['M200 165h50', 225, 111, 'middle'], ['M420 165h50', 445, 111, 'middle'], ['M640 165h50', 665, 111, 'middle']],
    boundary: { x: 230, y: 72, width: 650, height: 190, labelX: 250, labelY: 98 },
  },
  folded: {
    viewBox: '0 0 480 320',
    nodes: [[30, 30], [280, 30], [280, 200], [30, 200]],
    links: [['M200 70h80', 240, 55, 'middle'], ['M365 110v90', 378, 158, 'start'], ['M280 240h-80', 240, 225, 'middle']],
    boundary: null,
  },
  compact: {
    viewBox: '0 0 340 520',
    nodes: [[85, 30], [85, 155], [85, 280], [85, 405]],
    links: [['M170 110v45', 185, 136, 'start'], ['M170 235v45', 185, 261, 'start'], ['M170 360v45', 185, 386, 'start']],
    boundary: { x: 65, y: 133, width: 210, height: 372, labelX: 80, labelY: 148 },
  },
} as const;

/** Three arrangements keep the recorded example readable as the canvas narrows. */
function CatalogMap({ layout }: { layout: keyof typeof mapLayouts }) {
  const diagram = mapLayouts[layout];
  const labels = ['Customer', 'API Gateway', 'Catalog Service', 'Catalog DB'];
  const kinds = ['CLIENT', 'ENTRY POINT', 'SERVICE', 'POSTGRESQL'];
  const links = ['HTTPS', 'Route requests', 'Read items'];
  const marker = `catalog-arrow-${layout}`;
  const boundary = diagram.boundary;
  return <svg className={`lp-map-${layout}`} viewBox={diagram.viewBox} role="img" aria-label="Catalog architecture: Customer calls API Gateway, which routes requests to Catalog Service, which reads items from Catalog DB in PostgreSQL. All four components come from the description; the gateway-to-service connection is inferred.">
    <defs>{['described', 'inferred'].map(provenance => <marker key={provenance} id={`${marker}-${provenance}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="m1 1 8 4-8 4" fill="none" stroke={provenance === 'inferred' ? '#e9c283' : '#7fb7a9'} strokeWidth="1.5" />
    </marker>)}</defs>
    {boundary && <><rect className="lp-map-boundary" x={boundary.x} y={boundary.y} width={boundary.width} height={boundary.height} rx="18" /><text className="lp-map-boundary-label" x={boundary.labelX} y={boundary.labelY}>CATALOG BACKEND</text></>}
    {diagram.links.map(([path, x, y, anchor], i) => {
      const provenance = i === 1 ? 'inferred' : 'described';
      return <g key={links[i]} data-provenance={provenance} className={i === 1 ? 'lp-map-connection lp-map-inspected' : 'lp-map-connection'}>
        <path d={path} fill="none" stroke="#7fb7a9" strokeWidth="1.5" markerEnd={`url(#${marker}-${provenance})`} />
        <text x={x} y={y} textAnchor={anchor}>{links[i]}</text>
      </g>;
    })}
    {diagram.nodes.map(([x, y], i) => <g key={labels[i]} className="lp-map-node" transform={`translate(${x} ${y})`}>
      <rect width="170" height="80" rx="12" />
      <text className="lp-map-kind" x="16" y="25">{kinds[i]}</text>
      <text className="lp-map-name" x="16" y="51">{labels[i]}</text>
      <circle cx="151" cy="22" r="3" />
    </g>)}
  </svg>;
}

export function ProductPreview() {
  const [step, setStep] = useState(0);
  const remaining = useRef(8_000);
  const startedAt = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (!playing) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => {
      remaining.current = 8_000;
      if (step === steps.length - 1) { setPlaying(false); setFinished(true); }
      else setStep(step + 1);
    }, remaining.current);
    return () => clearTimeout(timer);
  }, [playing, step]);
  const select = (index: number) => { remaining.current = 8_000; setPlaying(false); setFinished(false); setStarted(false); setStep(index); };
  const play = () => {
    if (playing) { remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current)); setPlaying(false); return; }
    if (finished || !started) { remaining.current = 8_000; setStep(0); }
    setFinished(false); setStarted(true); setPlaying(true);
  };
  const current = steps[step]!;
  return <section className="lp-product" id="example" aria-label="Recorded product walkthrough" data-step={step} data-playing={playing}>
    <div className="lp-product-top"><span><i aria-hidden="true" /> THE CATALOG SYSTEM</span><span className="lp-product-label">Recorded example · no AI calls</span></div>
    <div className="lp-product-body">
      <div className="lp-story">
        <div className="lp-story-controls" role="group" aria-label="Walkthrough steps">{steps.map((item, index) => <button key={item.title} type="button" aria-pressed={step === index} onClick={() => select(index)}><span>0{index + 1}</span>{item.title}</button>)}</div>
        <div className="lp-story-content">
          <span className="lp-story-kicker">FROM CONTEXT TO CLARITY</span>
          <h2>{current.heading}</h2>
          <p className="lp-story-example">{current.text}</p>
          <p role="status">{current.note}</p>
          {step === 2 && <a className="lp-preview-download" href="/examples/catalog-architecture.svg" download>Download example SVG <span aria-hidden="true">↗</span></a>}
        </div>
        <button className="lp-play" type="button" onClick={play}><span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span>{playing ? 'Pause walkthrough' : finished ? 'Replay walkthrough' : started ? 'Resume walkthrough' : 'Play walkthrough'}<span className="lp-play-duration">24s</span></button>
      </div>
      <div className="lp-map"><CatalogMap layout="wide" /><CatalogMap layout="folded" /><CatalogMap layout="compact" /><div className="lp-map-caption"><span><i aria-hidden="true" /> Described <i className="lp-inferred-dot" aria-hidden="true" /> Inferred</span><span>4 components · 3 connections</span></div></div>
    </div>
    <div className="lp-product-bottom"><span><span aria-hidden="true">◇</span> One system. A picture you can question.</span><a href="/examples/catalog-architecture.svg" download>View example SVG <span aria-hidden="true">↗</span></a></div>
  </section>;
}
