import SwiftUI
import WebKit
import AVFoundation

struct SoundCloudWebView: UIViewRepresentable {
    @Binding var canGoBack: Bool
    @Binding var canGoForward: Bool
    @Binding var isLoading: Bool
    let webView: WKWebView

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        setupAudioSession()

        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

        if webView.url == nil {
            if let initialURL = URL(string: "https://soundcloud.com/discover") {
                webView.load(URLRequest(url: initialURL))
            }
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // UI updates if needed
    }

    private func setupAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers, .allowAirPlay])
            try session.setActive(true)
        } catch {
            print("[SoundCloudApp] AudioSession error: \(error)")
        }
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: SoundCloudWebView

        init(_ parent: SoundCloudWebView) {
            self.parent = parent
            super.init()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "nativeStorage", let jsonString = message.body as? String {
                UserDefaults.standard.set(jsonString, forKey: "sc_cue_storage")
                print("[SoundCloudApp] Cue storage updated via bridge.")
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
            parent.canGoBack = webView.canGoBack
            parent.canGoForward = webView.canGoForward

            // Sync latest cues from UserDefaults into page's localStorage
            if let saved = UserDefaults.standard.string(forKey: "sc_cue_storage"), !saved.isEmpty {
                let escaped = saved.replacingOccurrences(of: "\\", with: "\\\\")
                                   .replacingOccurrences(of: "'", with: "\\'")
                                   .replacingOccurrences(of: "\n", with: "")
                let js = "try { localStorage.setItem('sc_cue_storage', '\(escaped)'); } catch(e){}"
                webView.evaluateJavaScript(js, completionHandler: nil)
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.canGoBack = webView.canGoBack
            parent.canGoForward = webView.canGoForward
        }
    }
}
