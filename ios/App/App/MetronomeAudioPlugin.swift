import Foundation
import AVFoundation
import Capacitor

@objc(MetronomeAudioPlugin)
public class MetronomeAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {
    public let identifier = "MetronomeAudioPlugin"
    public let jsName = "MetronomeAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepareLoop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLoop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLoop", returnType: CAPPluginReturnPromise)
    ]

    private var player: AVAudioPlayer?
    private var loopFileURL: URL?

    @objc func prepareLoop(_ call: CAPPluginCall) {
        guard let base64 = call.getString("base64") else {
            call.reject("base64 required")
            return
        }
        guard let data = Data(base64Encoded: base64) else {
            call.reject("Invalid base64")
            return
        }

        player?.stop()
        player = nil

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("metro_loop.wav")
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject("File write failed: \(error)")
            return
        }
        loopFileURL = url

        do {
            let p = try AVAudioPlayer(contentsOf: url)
            p.numberOfLoops = -1
            p.volume = 1.0
            p.delegate = self
            p.prepareToPlay()
            player = p
        } catch {
            call.reject("AVAudioPlayer init failed: \(error)")
            return
        }

        call.resolve()
    }

    @objc func startLoop(_ call: CAPPluginCall) {
        guard let p = player else {
            call.reject("Not prepared")
            return
        }
        let muted = call.getBool("muted") ?? false
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback, mode: .default, options: [.mixWithOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[MetronomeAudio] AVAudioSession error: \(error)")
        }
        p.volume = muted ? 0.0 : 1.0
        p.play()
        call.resolve()
    }

    @objc func stopLoop(_ call: CAPPluginCall) {
        player?.pause()
        call.resolve()
    }
}
