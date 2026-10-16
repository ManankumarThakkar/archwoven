import { describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { buildSvg } from './export-svg';
import { sequenceDiagram } from './sequence';

const model = () => structuredClone(validFullModel);
describe('product sequence rendering', () => {
  it('keeps both fragment labels visible when nested bands start on the same message', () => {
    const m = model(); const seq = m.views.find(v => v.type === 'sequence')!.sequence!;
    for (const message of seq.messages) message.fragment = null;
    seq.messages[0]!.fragment = { type: 'loop', covers: [1, 2, 3] };
    seq.messages[1]!.fragment = { type: 'alt', covers: [1, 2] };
    const svg = sequenceDiagram(m, 'view.sequence').svg;
    const tabs = svg.match(/<rect data-fragment-tab="[^"]+" x="[^"]+" y="[^"]+"/g) ?? [];
    expect(tabs).toHaveLength(2);
    const positions = tabs.map(tab => tab.slice(tab.indexOf(' x=')));
    expect(new Set(positions).size).toBe(2);
  });
  it('exports timeline lifelines and messages instead of the graph layout', async () => {
    const svg = await buildSvg(model(), 'view.sequence');
    expect(svg).toContain('data-lifeline=');
    expect(svg).toContain('data-message="1"');
    expect(svg).toContain('ALT');
  });
  it('retains message order, different arrows, self-calls and bounded multiline labels', () => {
    const m = model(); const seq = m.views.find(v => v.type === 'sequence')!.sequence!;
    seq.messages = [
      { seq: 1, from: seq.participants[0]!, to: seq.participants[1]!, label: 'A very long message explaining a catalogue request and its validation without losing the rest of the full label', kind: 'call' },
      { seq: 2, from: seq.participants[1]!, to: seq.participants[1]!, label: 'Validate locally', kind: 'call', fragment: { type: 'loop', covers: [2, 3] } },
      { seq: 3, from: seq.participants[1]!, to: seq.participants[0]!, label: 'Result', kind: 'return' },
      { seq: 4, from: seq.participants[0]!, to: seq.participants[1]!, label: 'Notify', kind: 'async' },
    ];
    const d = sequenceDiagram(m, 'view.sequence');
    expect(d.svg.indexOf('data-message="1"')).toBeLessThan(d.svg.indexOf('data-message="2"'));
    expect(d.svg).toContain('data-self-call="true"');
    expect(d.svg).toContain('url(#sequence-call)');
    expect(d.svg).toContain('url(#sequence-open)');
    expect(d.svg).toContain('stroke-dasharray="6 4"');
    expect(d.svg).toContain('LOOP');
    expect(d.svg).toContain('<tspan');
    expect(d.svg).toContain('full label');
    expect(d.svg).not.toMatch(/NaN|undefined/);
    expect(d.height).toBeGreaterThan(250);
  });
  it('deduplicates repeated fragment bands and escapes all untrusted text and attributes', () => {
    const m = model(); const seq = m.views.find(v => v.type === 'sequence')!.sequence!;
    m.title = '<script>bad</script>'; m.nodes[0]!.label = '<img onerror="bad"/>';
    seq.messages[0]!.label = '<script onload="bad"> & more';
    seq.messages[0]!.fragment = { type: 'alt', covers: [1, 2] };
    seq.messages[1]!.fragment = { type: 'alt', covers: [1, 2] };
    for (const msg of seq.messages.slice(2)) msg.fragment = null;
    const { svg } = sequenceDiagram(m, 'view.sequence');
    expect(svg.match(/data-fragment=/g)).toHaveLength(1);
    expect(svg).toContain('&lt;script'); expect(svg).not.toMatch(/<script|<img|<foreignObject/);
    expect(svg.match(/<[^>]+>/g)!.every(tag => !/\son\w+=|href=/.test(tag))).toBe(true);
  });
  it('refuses missing metadata and fragment references rather than drawing an invented timeline', async () => {
    const m = model(); const view = m.views.find(v => v.type === 'sequence')!;
    view.sequence!.messages[0]!.fragment = { type: 'loop', covers: [999] };
    expect(() => sequenceDiagram(m, view.id)).toThrow(/fragment/i);
    view.sequence = null;
    await expect(buildSvg(m, view.id)).rejects.toThrow(/timeline|sequence/i);
  });
});
