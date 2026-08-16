import Foundation
import UIKit
import UniformTypeIdentifiers
import Capacitor

// Durable storage for the app's persisted state, plus backup file I/O.
//
// WKWebView's localStorage is not a safe home for data the user would be
// upset to lose: WebKit may evict it under storage pressure. This plugin
// keeps a mirror in Application Support, which is app-private and included
// in device backups, and the web layer rehydrates from it on launch.
@objc(DataStorePlugin)
public class DataStorePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "DataStorePlugin"
    public let jsName = "DataStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importFile", returnType: CAPPluginReturnPromise)
    ]

    private static let storeFileName = "metrobeat-store.json"

    /// Held across the document picker's presentation.
    private var pendingImportCall: CAPPluginCall?

    private func storeURL() throws -> URL {
        let fm = FileManager.default
        let dir = try fm.url(for: .applicationSupportDirectory,
                             in: .userDomainMask,
                             appropriateFor: nil,
                             create: true)
        if !fm.fileExists(atPath: dir.path) {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent(Self.storeFileName)
    }

    @objc func read(_ call: CAPPluginCall) {
        do {
            let url = try storeURL()
            guard FileManager.default.fileExists(atPath: url.path) else {
                call.resolve(["exists": false])
                return
            }
            let json = try String(contentsOf: url, encoding: .utf8)
            call.resolve(["exists": true, "json": json])
        } catch {
            // A read failure must not block startup — the web layer falls
            // back to whatever localStorage still holds.
            call.resolve(["exists": false])
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json required")
            return
        }
        do {
            // .atomic so a crash mid-write cannot leave a truncated store.
            try json.write(to: try storeURL(), atomically: true, encoding: .utf8)
            call.resolve(["ok": true])
        } catch {
            call.reject("Write failed: \(error.localizedDescription)")
        }
    }

    @objc func exportFile(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json required")
            return
        }
        let name = call.getString("filename") ?? "metro-beat-backup.json"
        DispatchQueue.main.async { [weak self] in
            guard let self, let vc = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            do {
                try json.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                call.reject("Could not prepare the backup file")
                return
            }
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // Required on iPad: without an anchor the popover crashes.
            if let pop = share.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX,
                                        y: vc.view.bounds.midY,
                                        width: 0, height: 0)
                pop.permittedArrowDirections = []
            }
            share.completionWithItemsHandler = { _, completed, _, _ in
                call.resolve(["completed": completed])
            }
            vc.present(share, animated: true)
        }
    }

    @objc func importFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let vc = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            self.pendingImportCall = call
            let types: [UTType] = [.json, .text]
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            vc.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController,
                               didPickDocumentsAt urls: [URL]) {
        guard let call = pendingImportCall else { return }
        pendingImportCall = nil
        guard let url = urls.first else {
            call.resolve(["cancelled": true])
            return
        }
        // Files chosen outside the app container are security scoped.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let json = try String(contentsOf: url, encoding: .utf8)
            call.resolve(["cancelled": false, "json": json])
        } catch {
            call.reject("Could not read the selected file")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pendingImportCall else { return }
        pendingImportCall = nil
        call.resolve(["cancelled": true])
    }
}
