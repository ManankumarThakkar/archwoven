// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './download';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('downloadBlob', () => {
  it('downloads the blob under the given name and frees its URL only after the download has started', () => {
    vi.useFakeTimers();
    const blob = new Blob(['{}'], { type: 'application/json' });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:model');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });

    downloadBlob(blob, 'archwoven-orders-r3.json');

    expect(create).toHaveBeenCalledWith(blob);
    expect(clicks).toEqual([{ href: 'blob:model', download: 'archwoven-orders-r3.json' }]);
    // Safari has cancelled downloads whose object URL was revoked in the same task as the click.
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(39_999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:model');
  });

  it('still frees the URL when the click throws', () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:model');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('blocked'); });

    expect(() => downloadBlob(new Blob(['x']), 'a.svg')).toThrow('blocked');
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:model');
  });
});
