import SwiftUI
import WebKit

struct PopupSheetView: View {
    @Environment(\.presentationMode) var presentationMode

    var body: some View {
        NavigationView {
            PopupWebView()
                .navigationBarTitle("Quản lý Cue", displayMode: .inline)
                .navigationBarItems(trailing: Button("Xong") {
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

        userContentController.add(LeakAvoider(delegate: context.coordinator), name: "nativeStorage")
        config.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = context.coordinator
        context.coordinator.webView = webView

        // Tìm và load popup.html
        var popupURL: URL? = nil
        if let url = Bundle.main.url(forResource: "popup", withExtension: "html", subdirectory: "WebResources/popup") {
            popupURL = url
        } else if let url = Bundle.main.url(forResource: "popup", withExtension: "html", subdirectory: "popup") {
            popupURL = url
        } else if let url = Bundle.main.url(forResource: "popup", withExtension: "html") {
            popupURL = url
        }

        if let url = popupURL {
            webView.loadFileURL(url, allowingReadAccessTo: Bundle.main.bundleURL)
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate {
        weak var webView: WKWebView?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "nativeStorage", let jsonString = message.body as? String {
                UserDefaults.standard.set(jsonString, forKey: "sc_cue_storage")
                WebViewManager.shared.syncStorageToWebView()
            }
        }

        // Hiển thị hộp thoại alert() của JavaScript trên iOS
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let rootVC = windowScene.windows.first?.rootViewController else {
                completionHandler()
                return
            }
            let alert = UIAlertController(title: "Thông báo", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            
            var presenter = rootVC
            while let presented = presenter.presentedViewController {
                presenter = presented
            }
            presenter.present(alert, animated: true)
        }

        // Hiển thị hộp thoại confirm() của JavaScript trên iOS
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let rootVC = windowScene.windows.first?.rootViewController else {
                completionHandler(false)
                return
            }
            let alert = UIAlertController(title: "Xác nhận", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Hủy", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "Đồng ý", style: .destructive) { _ in completionHandler(true) })
            
            var presenter = rootVC
            while let presented = presenter.presentedViewController {
                presenter = presented
            }
            presenter.present(alert, animated: true)
        }
    }
}
