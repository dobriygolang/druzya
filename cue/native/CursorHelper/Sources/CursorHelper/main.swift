// CursorHelper — freeze / thaw the macOS system cursor.
//
// Reads whitespace-terminated commands on stdin:
//   freeze\n   — park cursor at its current position; detach from mouse
//   thaw\n     — reattach cursor to mouse input
//   quit\n     — thaw (if frozen) and exit
//
// Writes state lines on stdout:
//   frozen\n
//   thawed\n
//   ready\n   (emitted on startup)
//   error:<msg>\n
//
// Safety: if the process dies while frozen (crash, SIGKILL, parent
// hangup), we install a best-effort atexit handler to re-associate the
// cursor so the user isn't left with a stuck pointer. SIGKILL of course
// bypasses that — acceptable risk since the parent Electron process is
// the only thing sending SIGKILL and it only does so on app quit, at
// which point cursor state is moot.

import CoreGraphics
import Darwin
import Foundation

// MARK: - State

private var isFrozen: Bool = false

// MARK: - Primitives

private func currentCursorPoint() -> CGPoint {
    let evt = CGEvent(source: nil)
    return evt?.location ?? .zero
}

@discardableResult
private func doFreeze() -> String {
    let pt = currentCursorPoint()
    // Detach cursor from mouse motion. The mouse still moves internally
    // (clicks land where the user drags to) but the on-screen cursor
    // stops at the warped position.
    let r1 = CGAssociateMouseAndMouseCursorPosition(0)
    guard r1 == .success else {
        return "error:CGAssociateMouseAndMouseCursorPosition(0) failed"
    }
    let r2 = CGWarpMouseCursorPosition(pt)
    guard r2 == .success else {
        // Try to reattach on failure so we don't strand the user.
        _ = CGAssociateMouseAndMouseCursorPosition(1)
        return "error:CGWarpMouseCursorPosition failed"
    }
    isFrozen = true
    return "frozen"
}

@discardableResult
private func doThaw() -> String {
    let r = CGAssociateMouseAndMouseCursorPosition(1)
    guard r == .success else {
        return "error:CGAssociateMouseAndMouseCursorPosition(1) failed"
    }
    isFrozen = false
    return "thawed"
}

// MARK: - Cleanup

private func installShutdownHandler() {
    // atexit — fires on normal exit and most signal-terminated exits.
    atexit {
        if isFrozen {
            _ = CGAssociateMouseAndMouseCursorPosition(1)
        }
    }
    // Handle SIGTERM / SIGINT / SIGHUP explicitly so we can flush stdout
    // before the process dies.
    let terminators: [Int32] = [SIGTERM, SIGINT, SIGHUP]
    for s in terminators {
        signal(s) { _ in
            if isFrozen { _ = CGAssociateMouseAndMouseCursorPosition(1) }
            _exit(0)
        }
    }
}

// MARK: - I/O loop

private func writeLine(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

private func runLoop() {
    writeLine("ready")
    // Line-buffered stdin read. We do not use Foundation.Pipe or async
    // because pipes from electron's `child_process.spawn` are plain
    // blocking fds and that's what we want here.
    while let line = readLine(strippingNewline: true) {
        let cmd = line.trimmingCharacters(in: .whitespaces)
        switch cmd {
        case "freeze":
            writeLine(doFreeze())
        case "thaw":
            writeLine(doThaw())
        case "quit":
            if isFrozen { _ = doThaw() }
            writeLine("thawed")
            return
        case "":
            continue
        default:
            writeLine("error:unknown command: \(cmd)")
        }
    }
    // EOF on stdin = parent hung up. Thaw and exit quietly.
    if isFrozen { _ = doThaw() }
}

// MARK: - Entry

installShutdownHandler()
runLoop()
