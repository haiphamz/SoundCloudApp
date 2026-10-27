import SwiftUI
import WebKit

struct PopupSheetView: View {
    @Environment(\.presentationMode) var presentationMode

    var body: some View {
        NavigationView {
            PopupWebView()
                .navigationBarTitle("Cue Manager", displayMode: .inline)
                .navigationBarItems(trailing: Button("Đóng") {
                    WebViewManager.shared.syncStorageToWebView()
                    presentationMode.wrappedValue.dismiss()
                })
        }
    }
}

struct PopupWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        let userContentController = WKUserContentController()

        // Sync initial storage from UserDefaults
        if let saved = UserDefaults.standard.string(forKey: "sc_cue_storage"), !saved.isEmpty {
            let escaped = saved.replacingOccurrences(of: "\\", with: "\\\\")
                               .replacingOccurrences(of: "'", with: "\\'")
                               .replacingOccurrences(of: "\n", with: "")
            let initialStorageJS = "try { localStorage.setItem('sc_cue_storage', '\(escaped)'); } catch(e){}"
            let script = WKUserScript(source: initialStorageJS, injectionTime: .atDocumentStart, forMainFrameOnly: false)
            userContentController.addUserScript(script)
        }

        userContentController.add(context.coordinator, name: "nativeStorage")
        config.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: config)
        context.coordinator.webView = webView

        // Load popup.html
        var popupURL: URL? = nil
        if let url = Bundle.main.url(forResource: "popup", withExtension: "html", subdirectory: "WebResources/popup") {
            popupURL = url
        } else if let url = Bundle.main.url(forResource: "popup", withExtension: "html", subdirectory: "popup") {
            popupURL = url
        } else if let url = Bundle.main.url(forResource: "popup", withExtension: "html") {
            popupURL = url
        }

        if let url = popupURL {
            let readAccessURL = url.deletingLastPathComponent().deletingLastPathComponent()
            webView.loadFileURL(url, allowingReadAccessTo: readAccessURL)
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "nativeStorage", let jsonString = message.body as? String {
                UserDefaults.standard.set(jsonString, forKey: "sc_cue_storage")
                WebViewManager.shared.syncStorageToWebView()
            }
        }
    }
}
