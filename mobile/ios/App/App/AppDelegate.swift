import UIKit
import AVFoundation
import WebKit
import Capacitor

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
    ]

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

    @objc func openUrl(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { call.reject("Нет адреса"); return }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in ok ? call.resolve() : call.reject("Не удалось открыть") }
        }
    }
}

class LoginViewController: UIViewController, WKNavigationDelegate, UIAdaptivePresentationControllerDelegate {
    let webView: WKWebView
    private let startURL: URL
    var onNavigate: ((String) -> Void)?
    var onClose: (() -> Void)?
    private var closed = false
    private var urlObservation: NSKeyValueObservation?

    init(url: URL, title: String) {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: cfg)
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
