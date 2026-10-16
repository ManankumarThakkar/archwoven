import { describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { sequenceSvg, escapeXml } from './sequence';

describe('sequenceSvg', () => {
  const svg = () => sequenceSvg(validFullModel, 'view.sequence');

  it('renders one lifeline + header per participant', () => {
    const s = svg();
    const view = validFullModel.views[1]!;
    for (const p of view.sequence!.participants) {
      const label = validFullModel.nodes.find((n) => n.id === p)!.label;
      expect(s).toContain(label);
    }
  });

  it('renders one arrow per message and the alt fragment band', () => {
    const s = svg();
    const arrows = s.match(/marker-end="url\(#sequence-(?:call|open|return)\)"/g) ?? [];
    expect(arrows).toHaveLength(validFullModel.views[1]!.sequence!.messages.length);
    expect(s).toContain('ALT');
  });

  it('escapes special characters (safe SVG output)', () => {
    expect(escapeXml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&apos;');
    expect(svg()).not.toContain('<script');
    // xmlns is the required SVG namespace; remote LOADING refs are what's forbidden
    expect(svg()).not.toMatch(/href=["']http/);
    expect(svg()).not.toMatch(/url\(["']?http/);
    expect(svg()).not.toContain('foreignObject');
  });

  it('throws on a non-sequence view instead of emitting garbage', () => {
    expect(() => sequenceSvg(validFullModel, 'view.er')).toThrow(/sequence view/);
  });
});
