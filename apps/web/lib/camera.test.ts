import { describe, expect, it } from 'vitest';
import { planCamera } from './camera';

const canvas = { width: 1000, height: 600 };
const options = { padding: 20, reserveRight: 0, minReadable: 0.65, maxZoom: 2 };

describe('planCamera', () => {
  it('fits and centres content that stays readable', () => {
    const plan = planCamera({ x: 0, y: 0, width: 480, height: 280 }, canvas, options)!;
    expect(plan.partial).toBe(false);
    expect(plan.zoom).toBe(2);
    // Centred in the 960 × 560 area inside the padding.
    expect(plan.x).toBeCloseTo(20 + (960 - 960) / 2);
    expect(plan.y).toBeCloseTo(20 + (560 - 560) / 2);
  });

  it('keeps clear of an overlay on the right', () => {
    const plan = planCamera({ x: 0, y: 0, width: 800, height: 100 }, canvas, { ...options, reserveRight: 200 })!;
    expect(plan.zoom).toBeCloseTo(760 / 800);
    expect(plan.x + 800 * plan.zoom).toBeLessThanOrEqual(1000 - 200 - 20 + 1e-9);
  });

  it('shows the start of a wide diagram at the readable zoom instead of shrinking it', () => {
    const plan = planCamera({ x: -100, y: 50, width: 4000, height: 300 }, canvas, options)!;
    expect(plan.partial).toBe(true);
    expect(plan.zoom).toBe(0.65);
    expect(plan.x).toBeCloseTo(20 - -100 * 0.65); // left edge of the content at the padding
    expect(plan.y).toBeCloseTo(20 + (560 - 300 * 0.65) / 2 - 50 * 0.65); // still centred vertically, as it fits
  });

  it('starts a tall diagram at its top, and an overflowing one at its top-left corner', () => {
    const tall = planCamera({ x: 0, y: 0, width: 300, height: 5000 }, canvas, options)!;
    expect(tall.partial).toBe(true);
    expect(tall.y).toBeCloseTo(20);
    expect(tall.x).toBeCloseTo(20 + (960 - 300 * 0.65) / 2);
    const both = planCamera({ x: 10, y: 10, width: 9000, height: 9000 }, canvas, options)!;
    expect(both.x).toBeCloseTo(20 - 10 * 0.65);
    expect(both.y).toBeCloseTo(20 - 10 * 0.65);
  });

  it('fits everything when no readability floor is requested (explicit Fit View)', () => {
    const plan = planCamera({ x: 0, y: 0, width: 4000, height: 300 }, canvas, { ...options, minReadable: 0 })!;
    expect(plan.partial).toBe(false);
    expect(plan.zoom).toBeCloseTo(960 / 4000);
  });

  it('never zooms in past the maximum to reach the readability floor', () => {
    const plan = planCamera({ x: 0, y: 0, width: 4000, height: 300 }, canvas, { ...options, minReadable: 3 })!;
    expect(plan.zoom).toBe(2);
  });

  it('returns null when the canvas or content has no size yet', () => {
    expect(planCamera({ x: 0, y: 0, width: 100, height: 100 }, { width: 0, height: 0 }, options)).toBeNull();
    expect(planCamera({ x: 0, y: 0, width: 0, height: 0 }, canvas, options)).toBeNull();
    expect(planCamera({ x: 0, y: 0, width: 100, height: 100 }, { width: 100, height: 600 }, { ...options, reserveRight: 120 })).toBeNull();
  });
});
