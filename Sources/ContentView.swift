import SwiftUI
import WebKit

struct ContentView: View {
    @StateObject private var manager = WebViewManager.shared
    @State private var canGoBack: Bool = false
    @State private var canGoForward: Bool = false
    @State private var isLoading: Bool = false
    @State private var showCuePopup: Bool = false

    private let pastelPink = Color(red: 255/255, green: 117/255, blue: 143/255)
    private let lightPastel = Color(red: 255/255, green: 240/255, blue: 243/255)

    var body: some View {
        VStack(spacing: 0) {
            // Thanh điều hướng trên cùng
            HStack(spacing: 16) {
                Button(action: {
                    if manager.webView.canGoBack {
                        manager.webView.goBack()
                    }
                }) {
                    Image(systemName: "chevron.backward")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(canGoBack ? pastelPink : Color.gray.opacity(0.4))
                }
                .disabled(!canGoBack)

                Button(action: {
                    if manager.webView.canGoForward {
                        manager.webView.goForward()
                    }
                }) {
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(canGoForward ? pastelPink : Color.gray.opacity(0.4))
                }
                .disabled(!canGoForward)

                Button(action: {
                    manager.webView.reload()
                }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(pastelPink)
                }

                Spacer()

                // Nút mở Menu Quản lý Cue (Popup của extension)
                Button(action: {
                    showCuePopup = true
                }) {
                    HStack(spacing: 6) {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 14, weight: .bold))
                        Text("Quản lý Cue")
                            .font(.system(size: 14, weight: .bold))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(pastelPink)
                    .foregroundColor(.white)
                    .cornerRadius(16)
                    .shadow(color: pastelPink.opacity(0.3), radius: 4, x: 0, y: 2)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(lightPastel)

            // Thanh tiến trình tải trang (Loading bar)
            if isLoading {
                ProgressView()
                    .progressViewStyle(LinearProgressViewStyle(tint: pastelPink))
                    .frame(height: 2)
            } else {
                Divider()
            }

            // SoundCloud Web Content
            SoundCloudWebView(
                canGoBack: $canGoBack,
                canGoForward: $canGoForward,
                isLoading: $isLoading,
                webView: manager.webView
            )
            .edgesIgnoringSafeArea(.bottom)
        }
        .sheet(isPresented: $showCuePopup) {
            PopupSheetView()
        }
    }
}
