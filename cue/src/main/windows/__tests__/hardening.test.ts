// hardening.test.ts — pins the defensive surface every BrowserWindow
// gets. These checks aren't about stealth directly, but they protect it:
//
//   • window.open() spawning an in-app popup → that popup is NOT
//     stealth'ed (no setContentProtection on it) → appears in screen
//     capture → stealth boundary leaks.
//   • Cross-origin navigation → renderer replaced wholesale → no
//     guarantee on stealth surface (renderer reloads bundle without
//     re-applying main-side protection).
//   • Webview attachment → embedded NSView NOT covered by parent's
//     NSWindowSharingNone.
//
// Tested via electron mock — hardenWindow() registers handlers on
// webContents; we verify each handler is wired correctly.

import { describe, it, expect, vi } from 'vitest';
import { BrowserWindow, shell } from 'electron';

import { hardenWindow } from '../hardening';

function harden() {
  // Construct a fresh fake window via the mocked BrowserWindow.
  const win = new BrowserWindow() as unknown as {
    webContents: {
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      session: {
        setPermissionRequestHandler: ReturnType<typeof vi.fn>;
      };
      getURL: ReturnType<typeof vi.fn>;
    };
  };
  hardenWindow(win as unknown as Parameters<typeof hardenWindow>[0]);
  return win;
}

describe('hardenWindow', () => {
  it('registers a window-open handler that denies new windows', () => {
    const win = harden();
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    const handler = vi.mocked(win.webContents.setWindowOpenHandler).mock
      .calls[0][0];
    expect(handler({ url: 'https://example.com' } as never)).toEqual({
      action: 'deny',
    });
    expect(handler({ url: 'javascript:alert(1)' } as never)).toEqual({
      action: 'deny',
    });
  });

  it('forwards http(s) urls to OS browser via shell.openExternal', () => {
    const win = harden();
    const handler = vi.mocked(win.webContents.setWindowOpenHandler).mock
      .calls[0][0];
    handler({ url: 'https://druz9.online/' } as never);
    expect(shell.openExternal).toHaveBeenCalledWith('https://druz9.online/');
  });

  it('does NOT forward non-http(s) protocols (silent drop)', () => {
    const win = harden();
    vi.mocked(shell.openExternal).mockClear();
    const handler = vi.mocked(win.webContents.setWindowOpenHandler).mock
      .calls[0][0];
    handler({ url: 'file:///etc/passwd' } as never);
    handler({ url: 'javascript:void(0)' } as never);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('wires will-navigate to block cross-origin navigation', () => {
    const win = harden();
    const onCalls = vi.mocked(win.webContents.on).mock.calls;
    const willNav = onCalls.find((c) => c[0] === 'will-navigate');
    expect(willNav).toBeDefined();
  });

  it('wires will-attach-webview to refuse webview embedding', () => {
    const win = harden();
    const onCalls = vi.mocked(win.webContents.on).mock.calls;
    const willAttach = onCalls.find((c) => c[0] === 'will-attach-webview');
    expect(willAttach).toBeDefined();
    // Pretend a webview tag asks to attach — handler must preventDefault.
    const event = { preventDefault: vi.fn() };
    (willAttach as unknown as [string, (e: unknown) => void])[1](event);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('registers a permission-request handler that allows media+clipboard only', () => {
    const win = harden();
    expect(
      win.webContents.session.setPermissionRequestHandler,
    ).toHaveBeenCalledTimes(1);
    const handler = vi.mocked(
      win.webContents.session.setPermissionRequestHandler,
    ).mock.calls[0][0] as (
      contents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void;

    const callback = vi.fn();
    handler(null, 'media', callback);
    expect(callback).toHaveBeenCalledWith(true);

    handler(null, 'clipboard-read', callback);
    expect(callback).toHaveBeenLastCalledWith(true);

    handler(null, 'clipboard-sanitized-write', callback);
    expect(callback).toHaveBeenLastCalledWith(true);

    handler(null, 'notifications', callback);
    expect(callback).toHaveBeenLastCalledWith(false);

    handler(null, 'geolocation', callback);
    expect(callback).toHaveBeenLastCalledWith(false);
  });
});
