import UIKit
import AVFoundation
import WebKit
import Capacitor
import MediaPlayer

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // музыка продолжает играть при заблокированном экране и в фоне
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)
        application.beginReceivingRemoteControlEvents()
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

/// Главный экран: обычный мост Capacitor плюс наш плагин
class SplavViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SplavNativePlugin())
    }
}

/// Окно входа в Яндекс, SoundCloud и Звук: свой WebView, из которого ядро забирает токен
@objc(SplavNativePlugin)
public class SplavNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SplavNativePlugin"
    public let jsName = "SplavNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openLogin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeLogin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loginCookies", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loginEval", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearLogin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remoteCommands", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInfo", returnType: CAPPluginReturnPromise),
    ]

    private var remoteReady = false

    // звонок, Siri, будильник: iOS сообщает, когда перерыв закончился и можно продолжать
    override public func load() {
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let info = note.userInfo,
                  let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                self?.notifyListeners("interruption", data: ["state": "began"])
            } else {
                try? AVAudioSession.sharedInstance().setActive(true)
                var resume = true
                if let o = info[AVAudioSessionInterruptionOptionKey] as? UInt { resume = AVAudioSession.InterruptionOptions(rawValue: o).contains(.shouldResume) }
                self?.notifyListeners("interruption", data: ["state": "ended", "resume": resume])
            }
        }
        NotificationCenter.default.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { _ in
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
            try? AVAudioSession.sharedInstance().setActive(true)
        }
    }

    /// Экран блокировки: «трек назад / трек вперёд» вместо перемотки на 10 секунд
    @objc func remoteCommands(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let cc = MPRemoteCommandCenter.shared()
            cc.skipForwardCommand.isEnabled = false
            cc.skipBackwardCommand.isEnabled = false
            cc.seekForwardCommand.isEnabled = false
            cc.seekBackwardCommand.isEnabled = false
            cc.nextTrackCommand.isEnabled = true
            cc.previousTrackCommand.isEnabled = true
            if !self.remoteReady {
                self.remoteReady = true
                cc.nextTrackCommand.addTarget { [weak self] _ in self?.notifyListeners("remote", data: ["cmd": "next"]); return .success }
                cc.previousTrackCommand.addTarget { [weak self] _ in self?.notifyListeners("remote", data: ["cmd": "prev"]); return .success }
                cc.skipForwardCommand.addTarget { [weak self] _ in self?.notifyListeners("remote", data: ["cmd": "next"]); return .success }
                cc.skipBackwardCommand.addTarget { [weak self] _ in self?.notifyListeners("remote", data: ["cmd": "prev"]); return .success }
            }
            call.resolve()
        }
    }

    private var login: LoginViewController?

    @objc func openLogin(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { call.reject("Нет адреса"); return }
        let title = call.getString("title") ?? "Вход"
        DispatchQueue.main.async {
            self.login?.dismiss(animated: false)
            let vc = LoginViewController(url: url, title: title)
            vc.onNavigate = { [weak self] u in self?.notifyListeners("loginNav", data: ["url": u]) }
            vc.onClose = { [weak self] in self?.login = nil; self?.notifyListeners("loginClosed", data: [:]) }
            self.login = vc
            let nav = UINavigationController(rootViewController: vc)
            nav.modalPresentationStyle = .pageSheet
            nav.presentationController?.delegate = vc
            self.bridge?.viewController?.present(nav, animated: true)
            call.resolve()
        }
    }

    @objc func closeLogin(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let vc = self.login { vc.closeProgrammatically() }
            call.resolve()
        }
    }

    @objc func loginCookies(_ call: CAPPluginCall) {
        let name = call.getString("name")
        DispatchQueue.main.async {
            guard let store = self.login?.webView.configuration.websiteDataStore.httpCookieStore else { call.resolve(["cookies": []]); return }
            store.getAllCookies { cookies in
                let list = cookies.filter { name == nil || $0.name == name }.map { ["name": $0.name, "value": $0.value, "domain": $0.domain] }
                call.resolve(["cookies": list])
            }
        }
    }

    @objc func loginEval(_ call: CAPPluginCall) {
        guard let code = call.getString("code") else { call.reject("Нет кода"); return }
        DispatchQueue.main.async {
            guard let web = self.login?.webView else { call.resolve(["value": "null"]); return }
            web.callAsyncJavaScript("return JSON.stringify(await (\(code)))", arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let v): call.resolve(["value": (v as? String) ?? "null"])
                case .failure: call.resolve(["value": "null"])
                }
            }
        }
    }

    @objc func clearLogin(_ call: CAPPluginCall) {
        call.resolve()   // у окна входа своё временное хранилище: после закрытия оно и так пустое
    }

    /// Когда истекает подпись приложения: дата из встроенного профиля (его переписывает Sideloadly или SideStore)
    @objc func signInfo(_ call: CAPPluginCall) {
        guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
              let data = FileManager.default.contents(atPath: path),
              let text = String(data: data, encoding: .isoLatin1),
              let start = text.range(of: "<?xml"),
              let end = text.range(of: "</plist>"),
              let xml = String(text[start.lowerBound..<end.upperBound]).data(using: .isoLatin1),
              let plist = try? PropertyListSerialization.propertyList(from: xml, options: [], format: nil) as? [String: Any],
              let expires = plist["ExpirationDate"] as? Date
        else { call.resolve(["expires": NSNull()]); return }
        call.resolve(["expires": expires.timeIntervalSince1970 * 1000])
    }

    @objc func openUrl(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { call.reject("Нет адреса"); return }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in ok ? call.resolve() : call.reject("Не удалось открыть") }
        }
    }
}

let safariUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

class LoginViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, UIAdaptivePresentationControllerDelegate {
    let webView: WKWebView
    private let startURL: URL
    var onNavigate: ((String) -> Void)?
    var onClose: (() -> Void)?
    private var closed = false
    private var urlObservation: NSKeyValueObservation?

    init(url: URL, title: String) {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.customUserAgent = safariUA
        startURL = url
        super.init(nibName: nil, bundle: nil)
        self.title = title
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        overrideUserInterfaceStyle = .dark
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Отмена", style: .plain, target: self, action: #selector(cancel))
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        // адрес меняется и без перехода (токен Яндекса приходит в #access_token=…)
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] web, _ in
            if let u = web.url?.absoluteString { self?.onNavigate?(u) }
        }
        webView.load(URLRequest(url: startURL))
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = navigationAction.request.url?.absoluteString { onNavigate?(u) }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let u = webView.url?.absoluteString { onNavigate?(u) }
    }

    // окна «Войти через Google / Apple» открываются поверх, в том же хранилище
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.customUserAgent = safariUA
        popup.navigationDelegate = self
        popup.uiDelegate = self
        let vc = UIViewController()
        vc.view = popup
        vc.title = title
        navigationController?.pushViewController(vc, animated: true)
        return popup
    }
    func webViewDidClose(_ webView: WKWebView) {
        if webView !== self.webView { navigationController?.popToViewController(self, animated: true) }
    }

    @objc private func cancel() { closeProgrammatically() }
    func closeProgrammatically() {
        dismiss(animated: true)
        finish()
    }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish() }
    private func finish() {
        if closed { return }
        closed = true
        urlObservation = nil
        onClose?()
    }
}
