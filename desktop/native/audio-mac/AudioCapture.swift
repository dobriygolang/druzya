// AudioCapture — macOS system-audio capture binary.
//
// Spawned by the Electron main process; emits raw 16-bit little-endian
// PCM mono at 16kHz to stdout. Control commands come in as text lines
// on stdin:
//   "start\n"  — begin capturing (TCC prompt fires on first start)
//   "stop\n"   — stop capturing but keep the process alive for reuse
//   "quit\n"   — stop + exit(0)
// Status events land on stderr as "LEVEL: message" lines so the
// parent can parse them line-by-line without fighting the PCM byte
// stream on stdout.
//
// Why native: `navigator.mediaDevices.getDisplayMedia` in Electron's
// Chromium captures DISPLAY but not audio on macOS — Apple doesn't expose
// system-audio to WebRTC. ScreenCaptureKit is the only supported path.
//
// Permission: this binary needs Screen Recording permission GRANTED
// to its own bundle path (TCC is per-binary). On first start the OS
// raises a prompt; subsequent runs use the cached grant.
//
// Target: macOS 13+. We use SCStreamConfiguration.sampleRate/channelCount
// which require macOS 13.0. Older macOS would need AVAudioConverter
// fallback — skipped because Druz9 Copilot's minimum is 13 anyway.

import Foundation
import AVFoundation
import ScreenCaptureKit

// MARK: - PCM output

/// Stream output receiver. Converts Float32 non-interleaved to Int16
/// little-endian mono and writes to a provided sink.
final class AudioCaptureOutput: NSObject, SCStreamOutput {
    private let sink: (Data) -> Void

    init(sink: @escaping (Data) -> Void) {
        self.sink = sink
        super.init()
    }

    func stream(_ stream: SCStream,
                didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer) else { return }

        // ScreenCaptureKit always delivers Float32 PCM per its docs,
        // possibly interleaved if channelCount > 1. We asked for 1ch,
        // so interleaved == non-interleaved here, but we handle both to
        // stay robust to Apple tightening the contract.
        guard let pcm = sampleBufferToPCM16Mono(sampleBuffer) else {
            FileHandle.standardError.write("WARN: failed to convert sample buffer\n".data(using: .utf8)!)
            return
        }
        sink(pcm)
    }
}

/// Extract a Float32 channel array from the sample buffer, fold to mono
/// if needed, then encode as Int16 LE.
private func sampleBufferToPCM16Mono(_ sb: CMSampleBuffer) -> Data? {
    guard let fmtDesc = CMSampleBufferGetFormatDescription(sb),
          let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fmtDesc)?.pointee else {
        return nil
    }
    let frameCount = Int(CMSampleBufferGetNumSamples(sb))
    if frameCount == 0 { return nil }
    let channels = Int(asbd.mChannelsPerFrame)
    let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
    let isInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0

    // ABL with retained block buffer — we keep `blockBuffer` alive for
    // the duration of reads via the withRetainedBlockBuffer parameter.
    var ablPtr = AudioBufferList()
    var blockBuffer: CMBlockBuffer?
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sb,
        bufferListSizeNeededOut: nil,
        bufferListOut: &ablPtr,
        bufferListSize: MemoryLayout<AudioBufferList>.size,
        blockBufferAllocator: nil,
        blockBufferMemoryAllocator: nil,
        flags: 0,
        blockBufferOut: &blockBuffer
    )
    guard status == noErr, blockBuffer != nil else { return nil }

    // AudioBufferList can hold multiple AudioBuffers (one per channel
    // when non-interleaved). We either grab buffer[0] directly or
    // average across buffers for down-mix.
    let abl = UnsafeMutableAudioBufferListPointer(&ablPtr)
    var mono = [Float](repeating: 0, count: frameCount)

    if isInterleaved && channels >= 1 {
        // One buffer, samples are F0L F0R F1L F1R ... Down-mix by
        // averaging across channels.
        guard let data = abl[0].mData else { return nil }
        let ptr = data.assumingMemoryBound(to: Float.self)
        for i in 0..<frameCount {
            var sum: Float = 0
            for c in 0..<channels {
                sum += ptr[i * channels + c]
            }
            mono[i] = sum / Float(channels)
        }
    } else {
        // Non-interleaved: one AudioBuffer per channel. Average.
        let chCount = min(abl.count, channels)
        guard chCount > 0 else { return nil }
        for (bi, buf) in abl.enumerated() where bi < chCount {
            guard let data = buf.mData else { continue }
            let ptr = data.assumingMemoryBound(to: Float.self)
            for i in 0..<frameCount {
                mono[i] += ptr[i]
            }
        }
        for i in 0..<frameCount {
            mono[i] /= Float(chCount)
        }
    }

    _ = isFloat // silence unused warning — kept for a future "integer input" branch

    // Float [-1..1] → Int16 [-32768..32767]. Clip hard on overflow
    // (Whisper is tolerant of occasional clipped samples).
    var out = Data(count: frameCount * 2)
    out.withUnsafeMutableBytes { raw in
        guard let base = raw.bindMemory(to: Int16.self).baseAddress else { return }
        for i in 0..<frameCount {
            let s = max(-1.0, min(1.0, mono[i]))
            base[i] = Int16(s * 32767.0)
        }
    }
    return out
}

// MARK: - Capture controller

actor CaptureController {
    private var stream: SCStream?
    private var output: AudioCaptureOutput?
    private let sampleQueue = DispatchQueue(label: "druz9.audio-capture.samples",
                                            qos: .userInitiated)

    func start() async throws {
        if stream != nil { return } // idempotent

        // Pick any display as the SCStream anchor. capturesAudio=true
        // doesn't require display frames, but SCStream's contract
        // insists on a non-empty filter; we excludingApplications:[]
        // so the filter isn't literally empty.
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            throw CaptureError("no display available")
        }
        let filter = SCContentFilter(display: display,
                                     excludingApplications: [],
                                     exceptingWindows: [])

        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 16_000
        cfg.channelCount = 1
        // Video must still be on — SCStream refuses an "audio only"
        // config. Minimize overhead: 2x2 pixels, 1 FPS, which Apple's
        // runtime effectively no-ops.
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let output = AudioCaptureOutput { pcm in
            // stdout is thread-safe per POSIX for small writes; the
            // buffer here is typically 10-20 KB, well under PIPE_BUF
            // boundaries. Electron reads in its own rhythm.
            FileHandle.standardOutput.write(pcm)
        }
        let s = SCStream(filter: filter, configuration: cfg, delegate: nil)
        try s.addStreamOutput(output, type: .audio, sampleHandlerQueue: sampleQueue)
        try await s.startCapture()

        self.stream = s
        self.output = output
        log("INFO", "capture started (16kHz mono PCM16)")
    }

    func stop() async {
        guard let s = stream else { return }
        do {
            try await s.stopCapture()
        } catch {
            log("WARN", "stop error: \(error)")
        }
        stream = nil
        output = nil
        log("INFO", "capture stopped")
    }
}

struct CaptureError: Error, CustomStringConvertible {
    let message: String
    init(_ m: String) { self.message = m }
    var description: String { message }
}

// MARK: - Stdin control loop

// Deliberately nonisolated — the stderr write() is thread-safe via
// POSIX, and we want to call it from any actor/queue (sample queue,
// main, the capture actor) without awaits.
nonisolated func log(_ level: String, _ msg: String) {
    let line = "\(level): \(msg)\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
}

@main
struct Entry {
    static func main() async {
        let controller = CaptureController()

        // Signal handlers for clean shutdown when Electron exits
        // ungracefully. signal() returns the previous handler, which
        // we ignore.
        signal(SIGTERM, { _ in
            fputs("INFO: SIGTERM received, exiting\n", stderr)
            exit(0)
        })
        signal(SIGINT, { _ in
            fputs("INFO: SIGINT received, exiting\n", stderr)
            exit(0)
        })
        signal(SIGPIPE, SIG_IGN) // parent closed stdout — we handle via next write.

        log("READY", "waiting for commands on stdin")

        // Line-by-line stdin reader. FileHandle.availableData would
        // give us chunks without splitting; we convert each push to
        // lines to match the command protocol.
        let stdin = FileHandle.standardInput
        var buffer = Data()
        while true {
            let chunk = stdin.availableData
            if chunk.isEmpty {
                // EOF on stdin — parent closed pipes. Shut down.
                await controller.stop()
                exit(0)
            }
            buffer.append(chunk)

            // Drain whole lines out of the buffer.
            while let nl = buffer.firstIndex(of: 0x0a) {
                let line = buffer[..<nl]
                buffer = buffer[(nl + 1)...]
                let cmd = String(data: line, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespaces) ?? ""
                switch cmd {
                case "start":
                    do { try await controller.start() }
                    catch {
                        log("ERROR", "start failed: \(error)")
                    }
                case "stop":
                    await controller.stop()
                case "quit", "exit":
                    await controller.stop()
                    exit(0)
                case "":
                    break
                default:
                    log("WARN", "unknown command: \(cmd)")
                }
            }
        }
    }
}
