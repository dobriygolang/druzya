// AudioCapture — macOS audio capture binary (pure PCM streaming).
//
// Spawned by Electron main; emits raw 16-bit little-endian PCM mono at
// 16kHz to stdout. Status events on stderr as "LEVEL: message" lines.
// Stdin commands:
//   "start"        — system audio via ScreenCaptureKit (Zoom/Meet/colonki)
//   "start-mic"    — mic audio via AVAudioEngine.inputNode
//   "stop"         — stop current capture, keep process alive
//   "quit"/"exit"  — stop + exit(0)
//
// Apple SFSpeechRecognizer и SpeechAnalyzer удалены: для streaming они
// либо не дают realtime partials (SFSpeechRecognizer + ScreenCaptureKit
// батчит callback'и до endAudio()), либо не поддерживают ru_RU
// (SpeechAnalyzer на macOS 26.4 — asset unavailable). Транскрипция
// делается полностью backend'ом (Groq Whisper) с tier-aware model
// selection и monthly quota gate. См. backend/services/transcription/.
//
// Permissions: ScreenCaptureKit нужен Screen Recording (start), AVAudio
// нужен Microphone (start-mic). TCC prompt fires первое start-* command.
//
// Target: macOS 13+.

import Foundation
import AVFoundation
import ScreenCaptureKit

// MARK: - VAD config (shared by both capture paths)

/// Tunables для silence detector. Эмпирически подобрано для laptop mic +
/// system audio через ScreenCaptureKit.
private let vadRMSThreshold: Float = 0.008
/// 600ms silence @ 16kHz — natural end-of-sentence pause.
private let vadSilenceSamplesForBoundary: Int = 16_000 * 6 / 10
/// 8s — max single utterance без silence boundary; force-cut.
private let vadMaxSamplesWithoutBoundary: Int = 16_000 * 8

// MARK: - PCM stream output (used by both system + mic capture paths)

/// Простой sink: PCM bytes на stdout, BOUNDARY events на stderr.
/// Внутренний VAD решает когда писать (skip silence) и когда emit BOUNDARY.
final class PCMStreamer: @unchecked Sendable {
    private var silentSamples = 0
    private var samplesSinceBoundary = 0
    private var isSpeaking = false
    private let lock = NSLock()

    /// Передать chunk Int16 PCM bytes + RMS этого chunk'а.
    /// frameCount = чанк frames (samples).
    func ingest(pcm: Data, rms: Float, frameCount: Int) {
        lock.lock(); defer { lock.unlock() }
        if rms > vadRMSThreshold {
            silentSamples = 0
            isSpeaking = true
            samplesSinceBoundary += frameCount
            FileHandle.standardOutput.write(pcm)
            if samplesSinceBoundary >= vadMaxSamplesWithoutBoundary {
                FileHandle.standardError.write("BOUNDARY\n".data(using: .utf8)!)
                samplesSinceBoundary = 0
            }
        } else {
            silentSamples += frameCount
            if isSpeaking && silentSamples >= vadSilenceSamplesForBoundary {
                FileHandle.standardError.write("BOUNDARY\n".data(using: .utf8)!)
                isSpeaking = false
                samplesSinceBoundary = 0
            }
            // Silent samples deliberately not written (cost-saving half of VAD).
        }
    }

    func reset() {
        lock.lock(); defer { lock.unlock() }
        silentSamples = 0
        samplesSinceBoundary = 0
        isSpeaking = false
    }
}

// MARK: - System audio capture (ScreenCaptureKit)

final class SCAudioOutput: NSObject, SCStreamOutput {
    private let streamer: PCMStreamer
    init(streamer: PCMStreamer) { self.streamer = streamer; super.init() }

    func stream(_ stream: SCStream,
                didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .audio,
              sampleBuffer.isValid,
              CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard let (pcm, rms, _) = sampleBufferToPCM16Mono(sampleBuffer) else {
            FileHandle.standardError.write("WARN: sc sample convert failed\n".data(using: .utf8)!)
            return
        }
        streamer.ingest(pcm: pcm, rms: rms, frameCount: pcm.count / 2)
    }
}

/// CMSampleBuffer (interleaved Float32 / mixed channels) → (Int16 LE mono PCM,
/// RMS, Float32 mono samples). Down-mix multichannel via average. ScreenCaptureKit
/// configured at 16kHz mono поэтому обычно channels==1, но guard для безопасности.
private func sampleBufferToPCM16Mono(_ sb: CMSampleBuffer) -> (Data, Float, [Float])? {
    guard let fmtDesc = CMSampleBufferGetFormatDescription(sb),
          let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fmtDesc)?.pointee else {
        return nil
    }
    let frameCount = Int(CMSampleBufferGetNumSamples(sb))
    if frameCount == 0 { return nil }
    let channels = Int(asbd.mChannelsPerFrame)
    let isInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0

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

    let abl = UnsafeMutableAudioBufferListPointer(&ablPtr)
    var mono = [Float](repeating: 0, count: frameCount)

    if isInterleaved && channels >= 1 {
        guard let data = abl[0].mData else { return nil }
        let ptr = data.assumingMemoryBound(to: Float.self)
        for i in 0..<frameCount {
            var sum: Float = 0
            for c in 0..<channels { sum += ptr[i * channels + c] }
            mono[i] = sum / Float(channels)
        }
    } else {
        let chCount = min(abl.count, channels)
        guard chCount > 0 else { return nil }
        for (bi, buf) in abl.enumerated() where bi < chCount {
            guard let data = buf.mData else { continue }
            let ptr = data.assumingMemoryBound(to: Float.self)
            for i in 0..<frameCount { mono[i] += ptr[i] }
        }
        for i in 0..<frameCount { mono[i] /= Float(chCount) }
    }

    var out = Data(count: frameCount * 2)
    var sumSq: Float = 0
    out.withUnsafeMutableBytes { raw in
        guard let base = raw.bindMemory(to: Int16.self).baseAddress else { return }
        for i in 0..<frameCount {
            let s = max(-1.0, min(1.0, mono[i]))
            base[i] = Int16(s * 32767.0)
            sumSq += s * s
        }
    }
    let rms = sqrt(sumSq / Float(max(frameCount, 1)))
    return (out, rms, mono)
}

// MARK: - System audio capture controller

actor CaptureController {
    private var stream: SCStream?
    private var output: SCAudioOutput?
    private let streamer = PCMStreamer()
    private let sampleQueue = DispatchQueue(label: "druz9.audio-capture.samples", qos: .userInitiated)

    func start() async throws {
        if stream != nil { return }
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            throw CaptureError("no display available")
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 16_000
        cfg.channelCount = 1
        // SCStream требует non-zero video config даже для audio-only.
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        streamer.reset()
        let out = SCAudioOutput(streamer: streamer)
        let s = SCStream(filter: filter, configuration: cfg, delegate: nil)
        try s.addStreamOutput(out, type: .audio, sampleHandlerQueue: sampleQueue)
        try await s.startCapture()
        self.stream = s
        self.output = out
        log("INFO", "capture started (16kHz mono PCM16, system audio)")
    }

    func stop() async {
        guard let s = stream else { return }
        do { try await s.stopCapture() } catch { log("WARN", "stop error: \(error)") }
        stream = nil
        output = nil
        log("INFO", "capture stopped")
    }
}

// MARK: - Microphone capture controller (AVAudioEngine + AVAudioConverter)

@available(macOS 10.15, *)
actor MicCaptureController {
    private let audioEngine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private var converterInputFormat: AVAudioFormat?
    private let streamer = PCMStreamer()
    private var running = false

    /// 16kHz mono Float32 — целевой формат для PCM stream.
    private let targetFormat: AVAudioFormat = {
        AVAudioFormat(commonFormat: .pcmFormatFloat32,
                      sampleRate: 16_000,
                      channels: 1,
                      interleaved: false)!
    }()

    func start() async throws {
        if running { return }
        let inputNode = audioEngine.inputNode
        let nativeFormat = inputNode.outputFormat(forBus: 0)
        // Lazy converter — input format может различаться (44.1k stereo vs
        // 48k mono). Recreate'аем при изменении format.
        converter = AVAudioConverter(from: nativeFormat, to: targetFormat)
        converterInputFormat = nativeFormat
        streamer.reset()

        let streamerRef = streamer
        let convClosure: (AVAudioPCMBuffer) -> Void = { [weak self] buffer in
            guard let self = self else { return }
            Task { await self.feedBuffer(buffer, streamer: streamerRef) }
        }
        // bufferSize 1024 = ~25ms на 44.1k; matches Apple recommended range.
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: nativeFormat) { buffer, _ in
            convClosure(buffer)
        }
        audioEngine.prepare()
        try audioEngine.start()
        running = true
        log("INFO", "mic capture started (native=\(nativeFormat.sampleRate)Hz/\(nativeFormat.channelCount)ch → 16kHz/1ch)")
    }

    /// Конвертит native-format buffer в 16kHz mono Float32, затем в Int16 LE,
    /// считает RMS и feed'ит streamer'у. Тяжёлая работа — на actor'е чтобы не
    /// блокировать audio thread.
    private func feedBuffer(_ buffer: AVAudioPCMBuffer, streamer: PCMStreamer) {
        guard let conv = converter else { return }
        // Output capacity: ratio sample rates × input frames + slop для tail'а.
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let outCap = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 1024)
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: outCap) else { return }
        var error: NSError?
        var inputProvided = false
        let status = conv.convert(to: out, error: &error) { _, outStatus in
            if inputProvided { outStatus.pointee = .noDataNow; return nil }
            inputProvided = true
            outStatus.pointee = .haveData
            return buffer
        }
        if status == .error || error != nil {
            FileHandle.standardError.write("WARN: mic convert failed\n".data(using: .utf8)!)
            return
        }
        let frames = Int(out.frameLength)
        guard frames > 0, let chans = out.floatChannelData else { return }
        let monoPtr = chans[0]
        // Float32 → Int16 + RMS one-pass.
        var pcm = Data(count: frames * 2)
        var sumSq: Float = 0
        pcm.withUnsafeMutableBytes { raw in
            guard let base = raw.bindMemory(to: Int16.self).baseAddress else { return }
            for i in 0..<frames {
                let s = max(-1.0, min(1.0, monoPtr[i]))
                base[i] = Int16(s * 32767.0)
                sumSq += s * s
            }
        }
        let rms = sqrt(sumSq / Float(max(frames, 1)))
        streamer.ingest(pcm: pcm, rms: rms, frameCount: frames)
    }

    func stop() async {
        if !running { return }
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        converter = nil
        converterInputFormat = nil
        running = false
        log("INFO", "mic capture stopped")
    }
}

// MARK: - Errors + logging

struct CaptureError: Error, CustomStringConvertible {
    let message: String
    init(_ m: String) { self.message = m }
    var description: String { message }
}

nonisolated func log(_ level: String, _ msg: String) {
    let line = "\(level): \(msg)\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
}

// MARK: - Stdin control loop

@main
struct Entry {
    static func main() async {
        let controller = CaptureController()
        var micController: AnyObject? = nil // resolved to MicCaptureController on macOS 10.15+

        signal(SIGTERM, { _ in fputs("INFO: SIGTERM received, exiting\n", stderr); exit(0) })
        signal(SIGINT,  { _ in fputs("INFO: SIGINT received, exiting\n", stderr); exit(0) })
        signal(SIGPIPE, SIG_IGN)

        log("READY", "waiting for commands on stdin")

        let stdin = FileHandle.standardInput
        var buffer = Data()
        while true {
            let chunk = stdin.availableData
            if chunk.isEmpty {
                await controller.stop()
                exit(0)
            }
            buffer.append(chunk)
            while let nl = buffer.firstIndex(of: 0x0a) {
                let line = buffer[..<nl]
                buffer = buffer[(nl + 1)...]
                let cmd = String(data: line, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespaces) ?? ""
                switch cmd {
                case "start", "start-apple":
                    // System audio via ScreenCaptureKit. start-apple kept as
                    // alias for backwards-compat — same path now (no Apple SF).
                    do { try await controller.start() }
                    catch { log("ERROR", "start failed: \(error)") }
                case "start-mic":
                    if #available(macOS 10.15, *) {
                        let mc: MicCaptureController
                        if let existing = micController as? MicCaptureController {
                            mc = existing
                        } else {
                            mc = MicCaptureController()
                            micController = mc
                        }
                        do { try await mc.start() }
                        catch { log("ERROR", "start-mic failed: \(error)") }
                    } else {
                        log("ERROR", "start-mic requires macOS 10.15+")
                    }
                case "stop":
                    await controller.stop()
                    if #available(macOS 10.15, *) {
                        if let mc = micController as? MicCaptureController { await mc.stop() }
                    }
                case "quit", "exit":
                    await controller.stop()
                    if #available(macOS 10.15, *) {
                        if let mc = micController as? MicCaptureController { await mc.stop() }
                    }
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
