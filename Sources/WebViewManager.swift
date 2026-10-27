import Foundation
import WebKit

class WebViewManager: ObservableObject {
    static let shared = WebViewManager()

    let webView: WKWebView

    init() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        let userContentController = WKUserContentController()

        // 1. Initial Storage Sync script
        if let saved = UserDefaults.standard.string(forKey: "sc_cue_storage"), !saved.isEmpty {
            let escaped = saved.replacingOccurrences(of: "\\", with: "\\\\")
                               .replacingOccurrences(of: "'", with: "\\'")
                               .replacingOccurrences(of: "\n", with: "")
            let initialStorageJS = "try { localStorage.setItem('sc_cue_storage', '\(escaped)'); } catch(e){}"
            let script = WKUserScript(source: initialStorageJS, injectionTime: .atDocumentStart, forMainFrameOnly: false)
            userContentController.addUserScript(script)
        }

        // 2. iOS Bridge Script (Shim for chrome.storage & chrome.runtime)
        if let bridgeURL = WebViewManager.findResource(name: "ios_bridge", ext: "js"),
           let bridgeJS = try? String(contentsOf: bridgeURL, encoding: .utf8) {
            let script = WKUserScript(source: bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: false)
            userContentController.addUserScript(script)
        }

        // 3. Inject.js (Hook into SoundCloud audio and client ID)
        if let injectURL = WebViewManager.findResource(name: "inject", ext: "js"),
           let injectJS = try? String(contentsOf: injectURL, encoding: .utf8) {
            let script = WKUserScript(source: injectJS, injectionTime: .atDocumentStart, forMainFrameOnly: false)
            userContentController.addUserScript(script)
        }

        // 4. HLS.light.min.js
        if let hlsURL = WebViewManager.findResource(name: "hls.light.min", ext: "js"),
           let hlsJS = try? String(contentsOf: hlsURL, encoding: .utf8) {
            let script = WKUserScript(source: hlsJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
            userContentController.addUserScript(script)
        }

        // 5. Content.js (Cue Bar, Crossfader & Auto-Skip)
        if let contentURL = WebViewManager.findResource(name: "content", ext: "js"),
           let contentJS = try? String(contentsOf: contentURL, encoding: .utf8) {
            let script = WKUserScript(source: contentJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
            userContentController.addUserScript(script)
        }

        config.userContentController = userContentController
        self.webView = WKWebView(frame: .zero, configuration: config)
    }

    static func findResource(name: String, ext: String) -> URL? {
        if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "WebResources") {
            return url
        }
        if let url = Bundle.main.url(forResource: name, withExtension: ext) {
            return url
        }
        return nil
    }

    func syncStorageToWebView() {
        if let saved = UserDefaults.standard.string(forKey: "sc_cue_storage"), !saved.isEmpty {
            let escaped = saved.replacingOccurrences(of: "\\", with: "\\\\")
                               .replacingOccurrences(of: "'", with: "\\'")
                               .replacingOccurrences(of: "\n", with: "")
            let js = "try { localStorage.setItem('sc_cue_storage', '\(escaped)'); window.dispatchEvent(new Event('storage')); } catch(e){}"
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
