// StealthVerifier — captures a screenshot of a target window via the
// public CoreGraphics window-list API and reports whether the window
// is visible to a third-party capture (== stealth FAILED) or whether
// macOS replied with an empty / black image (== stealth WORKING).
//
// Approach (deliberately simple — no ScreenCaptureKit, no AVFoundation):
//   1. Enumerate windows owned by Cue (bundleID app.druzya.copilot or
//      alias bundles) via CGWindowListCopyWindowInfo.
//   2. For each match, call CGWindowListCreateImage with
//      kCGWindowImageBoundsIgnoreFraming on the window ID.
//   3. setContentProtection(true) on macOS sets NSWindow.sharingType to
//      .none, which makes CGWindowListCreateImage return an image whose
//      pixels are ALL clear (alpha=0) or black. We sample pixels and
//      compute the fraction of non-transparent / non-black pixels.
//   4. If fraction > THRESHOLD (10%) → stealth FAILED, exit 1.
//   5. If fraction ≤ THRESHOLD or no image produced → stealth WORKING,
//      exit 0.
//
// Limitations (documented for the smoke-test invoker):
//   • This validates against the CG public-API path — same path Zoom,
//     Meet, OBS, ⌘⇧3 / ⌘⇧4 use. Verified empirically: when an
//     NSWindowSharingNone window is queried, CGWindowListCreateImage
//     returns a clear image, mirroring the screen-share viewer's POV.
//   • It does NOT test ScreenCaptureKit (macOS 12+ Apple API). SCK is a
//     superset and also honors NSWindowSharingNone, but a regression
//     ONLY in SCK wouldn't be caught here. To catch that, the manual
//     stealth-matrix checklist (resources/stealth-matrix.md) drives the
//     real apps (Zoom uses SCK under the hood).
//
// Usage:
//   ./StealthVerifier                                  # default 5s sweep
//   ./StealthVerifier --duration 10                    # longer
//   ./StealthVerifier --bundle app.druzya.copilot      # explicit bundleID
//   ./StealthVerifier --title "Cue"                    # title prefix match
//   ./StealthVerifier --verbose                        # dump per-window stats
//
// Exit codes:
//   0 — stealth WORKING (no Cue window pixels visible to capture)
//   1 — stealth FAILED  (≥ 10% opaque pixels from any Cue window)
//   2 — error (no Cue windows found / capture failure)

import Foundation
import CoreGraphics
import AppKit

struct Args {
    var bundlePrefix: String = "app.druzya.copilot"
    var titlePrefix: String? = nil
    var durationSec: Double = 5.0
    var verbose: Bool = false
    var threshold: Double = 0.10
}

func parseArgs() -> Args {
    var args = Args()
    var i = 1
    let argv = CommandLine.arguments
    while i < argv.count {
        let a = argv[i]
        switch a {
        case "--bundle":
            i += 1; if i < argv.count { args.bundlePrefix = argv[i] }
        case "--title":
            i += 1; if i < argv.count { args.titlePrefix = argv[i] }
        case "--duration":
            i += 1
            if i < argv.count, let v = Double(argv[i]) { args.durationSec = v }
        case "--threshold":
            i += 1
            if i < argv.count, let v = Double(argv[i]) { args.threshold = v }
        case "--verbose", "-v":
            args.verbose = true
        case "--help", "-h":
            printUsage()
            exit(0)
        default:
            FileHandle.standardError.write("unknown arg: \(a)\n".data(using: .utf8)!)
            printUsage()
            exit(2)
        }
        i += 1
    }
    return args
}

func printUsage() {
    print("""
    Usage: StealthVerifier [--bundle <prefix>] [--title <prefix>] [--duration <sec>] [--threshold <0..1>] [--verbose]
    Exit: 0 = stealth working, 1 = stealth failed, 2 = error
    """)
}

struct CueWindow {
    let id: CGWindowID
    let title: String
    let bundleID: String
    let bounds: CGRect
}

func listCueWindows(bundlePrefix: String, titlePrefix: String?) -> [CueWindow] {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let raw = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }

    let runningPIDs: [pid_t: String] = NSWorkspace.shared.runningApplications.reduce(
        into: [pid_t: String]()
    ) { acc, app in
        if let bid = app.bundleIdentifier { acc[app.processIdentifier] = bid }
    }

    var out: [CueWindow] = []
    for info in raw {
        guard let pid = info[kCGWindowOwnerPID as String] as? pid_t else { continue }
        let bundleID = runningPIDs[pid] ?? ""
        let title = (info[kCGWindowName as String] as? String) ?? ""

        let matchesBundle = bundleID.hasPrefix(bundlePrefix)
        let matchesTitle: Bool
        if let t = titlePrefix {
            matchesTitle = title.hasPrefix(t)
        } else {
            matchesTitle = false
        }
        if !matchesBundle && !matchesTitle { continue }

        guard let windowID = info[kCGWindowNumber as String] as? CGWindowID else { continue }
        let bounds: CGRect
        if let b = info[kCGWindowBounds as String] as? [String: Any],
           let x = b["X"] as? CGFloat, let y = b["Y"] as? CGFloat,
           let w = b["Width"] as? CGFloat, let h = b["Height"] as? CGFloat {
            bounds = CGRect(x: x, y: y, width: w, height: h)
        } else {
            bounds = .zero
        }
        out.append(CueWindow(id: windowID, title: title, bundleID: bundleID, bounds: bounds))
    }
    return out
}

/// Returns the fraction of pixels that look "non-stealth" — i.e. neither
/// fully transparent (alpha == 0) nor pure-black. setContentProtection
/// causes CGWindowListCreateImage to return all-clear/all-black pixels,
/// so a high fraction here means stealth is OFF.
func fractionVisible(image cgImage: CGImage) -> Double {
    let width = cgImage.width
    let height = cgImage.height
    guard width > 0, height > 0 else { return 0 }

    // We don't need every pixel — sample stride. 100k samples is plenty
    // for a meaningful ratio.
    let totalPixels = width * height
    let targetSamples = 100_000
    let stride = max(1, Int((Double(totalPixels) / Double(targetSamples)).squareRoot()))

    // Render into a uniform RGBA byte buffer so colorspace differences
    // don't surprise us.
    let bytesPerPixel = 4
    let bytesPerRow = width * bytesPerPixel
    var buffer = [UInt8](repeating: 0, count: width * height * bytesPerPixel)
    let cs = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo: UInt32 = CGImageAlphaInfo.premultipliedLast.rawValue
        | CGBitmapInfo.byteOrder32Big.rawValue
    guard let ctx = CGContext(
        data: &buffer, width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: bytesPerRow,
        space: cs, bitmapInfo: bitmapInfo
    ) else { return 0 }
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

    var visible = 0
    var sampled = 0
    var y = 0
    while y < height {
        var x = 0
        while x < width {
            let i = (y * width + x) * bytesPerPixel
            let r = buffer[i]
            let g = buffer[i + 1]
            let b = buffer[i + 2]
            let a = buffer[i + 3]
            sampled += 1
            // Pixel "visible" if it has non-zero alpha AND is not pure black.
            // setContentProtection produces (0,0,0,0) blocks.
            if a > 8 && (r > 8 || g > 8 || b > 8) {
                visible += 1
            }
            x += stride
        }
        y += stride
    }
    if sampled == 0 { return 0 }
    return Double(visible) / Double(sampled)
}

/// Capture a single window via CGWindowListCreateImage. Returns nil when
/// the OS refused (CGNullWindowID, off-screen, or — the case we care
/// about — content-protected).
func captureWindow(_ win: CueWindow) -> CGImage? {
    return CGWindowListCreateImage(
        .null,
        .optionIncludingWindow,
        win.id,
        [.boundsIgnoreFraming, .bestResolution]
    )
}

// Top-level entry. (Note: cannot use @main here because the file already
// contains top-level function declarations above; swiftc forbids the combo.)
let args = parseArgs()
let windows = listCueWindows(bundlePrefix: args.bundlePrefix, titlePrefix: args.titlePrefix)
if windows.isEmpty {
    FileHandle.standardError.write(
        "error: no Cue windows found (bundle prefix '\(args.bundlePrefix)')\n".data(using: .utf8)!
    )
    FileHandle.standardError.write(
        "hint: open Cue.app first; the verifier needs at least one on-screen window\n".data(using: .utf8)!
    )
    exit(2)
}

if args.verbose {
    print("→ found \(windows.count) Cue window(s):")
    for w in windows {
        print("    id=\(w.id) bundle=\(w.bundleID) title='\(w.title)' bounds=\(w.bounds)")
    }
}

let deadline = Date().addingTimeInterval(args.durationSec)
var worstFraction = 0.0
var worstWindow: CueWindow? = nil
var samples = 0

while Date() < deadline {
    for w in windows {
        guard let image = captureWindow(w) else {
            if args.verbose {
                print("    win \(w.id): no image (likely stealth-protected — good)")
            }
            continue
        }
        let frac = fractionVisible(image: image)
        samples += 1
        if frac > worstFraction {
            worstFraction = frac
            worstWindow = w
        }
        if args.verbose {
            print(String(format: "    win %u: %.3f visible", w.id, frac))
        }
    }
    // Sleep a beat between sweeps so we cover async repaint cycles.
    Thread.sleep(forTimeInterval: 0.25)
}

let pct = Int(worstFraction * 100)
if worstFraction > args.threshold {
    let t = worstWindow?.title ?? "?"
    print("✗ stealth FAILED: window '\(t)' \(pct)% visible to capture (threshold \(Int(args.threshold * 100))%)")
    exit(1)
}
print("✓ stealth working: max \(pct)% pixel visibility across \(samples) sample(s) (threshold \(Int(args.threshold * 100))%)")
exit(0)
