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
        // iOS Safari User Agent chuẩn để giao diện vừa khít màn hình điện thoại & Google OAuth cho phép đăng nhập
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"

        if webView.url == nil {
            if let initialURL = URL(string: "https://soundcloud.com/discover") {
                webView.load(URLRequest(url: initialURL))
            }
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    private func setupAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers, .allowAirPlay])
            try session.setActive(true)
        } catch {
            print("[SoundCloudApp] AudioSession error: \(error)")
        }
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: SoundCloudWebView
        weak var activePopupNav: UINavigationController?

        init(_ parent: SoundCloudWebView) {
            self.parent = parent
            super.init()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
            parent.canGoBack = webView.canGoBack
            parent.canGoForward = webView.canGoForward

            // Đồng bộ dữ liệu mốc phát từ UserDefaults vào trang SoundCloud
            if let saved = UserDefaults.standard.string(forKey: "sc_cue_storage"), !saved.isEmpty {
                let escaped = saved.replacingOccurrences(of: "\\", with: "\\\\")
                                   .replacingOccurrences(of: "'", with: "\\'")
                                   .replacingOccurrences(of: "\n", with: "")
                let js = "try { localStorage.setItem('sc_cue_storage', '\(escaped)'); window.dispatchEvent(new Event('storage')); } catch(e){}"
                webView.evaluateJavaScript(js, completionHandler: nil)
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.canGoBack = webView.canGoBack
            parent.canGoForward = webView.canGoForward
        }

        // HỖ TRỢ POPUP ĐĂNG NHẬP GOOGLE / APPLE / FACEBOOK
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let rootVC = windowScene.windows.first?.rootViewController else {
                return nil
            }
            var topVC = rootVC
            while let presented = topVC.presentedViewController {
                topVC = presented
            }

            let popupWebView = WKWebView(frame: .zero, configuration: configuration)
            popupWebView.uiDelegate = self
            popupWebView.navigationDelegate = self
            popupWebView.customUserAgent = webView.customUserAgent

            let popupVC = UIViewController()
            popupVC.view = popupWebView
            popupVC.title = "Đăng nhập"

            let nav = UINavigationController(rootViewController: popupVC)
            popupVC.navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Đóng", style: .done, target: self, action: #selector(closePopup))

            self.activePopupNav = nav
            topVC.present(nav, animated: true)

            return popupWebView
        }

        func webViewDidClose(_ webView: WKWebView) {
            activePopupNav?.dismiss(animated: true)
            activePopupNav = nil
        }

        @objc func closePopup() {
            activePopupNav?.dismiss(animated: true)
            activePopupNav = nil
        }

        // Hiển thị alert() trên giao diện iOS
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let rootVC = windowScene.windows.first?.rootViewController else {
                completionHandler()
                return
            }
            let alert = UIAlertController(title: "SoundCloud VH", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            
            var presenter = rootVC
            while let presented = presenter.presentedViewController {
                presenter = presented
            }
            presenter.present(alert, animated: true)
        }

        // Hiển thị confirm() trên giao diện iOS
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let rootVC = windowScene.windows.first?.rootViewController else {
                completionHandler(false)
                return
            }
            let alert = UIAlertController(title: "SoundCloud VH", message: message, preferredStyle: .alert)
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
