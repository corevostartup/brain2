//
//  WindowChrome.swift
//  Brain2
//

import AppKit
import SwiftUI

private final class WindowHostView: NSView {
    var onWindow: ((NSWindow?) -> Void)?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        onWindow?(window)
    }
}

/// Ações de janela fiáveis (não dependem de `Binding` para `NSWindow`, que costuma falhar com SwiftUI).
enum WindowChromeActions {
    private static var targetWindow: NSWindow? {
        if let w = NSApp.keyWindow ?? NSApp.mainWindow { return w }
        return NSApp.windows.last(where: \.isVisible)
    }

    static func closeFocusedWindow() {
        NSApp.sendAction(#selector(NSWindow.performClose(_:)), to: nil, from: nil)
    }

    static func miniaturizeFocusedWindow() {
        targetWindow?.miniaturize(nil)
    }

    static func zoomFocusedWindow() {
        targetWindow?.zoom(nil)
    }
}

/// Configura janela: sem barra de título visível, sem traffic lights do sistema, conteúdo em tela cheia na área cliente.
struct WindowChromeConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = WindowHostView()
        view.onWindow = { win in
            guard let window = win else { return }
            DispatchQueue.main.async {
                window.title = ""
                window.titlebarAppearsTransparent = true
                window.titleVisibility = .hidden
                window.toolbar = nil
                window.titlebarSeparatorStyle = .none
                window.styleMask.insert(.fullSizeContentView)
                window.standardWindowButton(.closeButton)?.isHidden = false
                window.standardWindowButton(.miniaturizeButton)?.isHidden = false
                window.standardWindowButton(.zoomButton)?.isHidden = false
                window.backgroundColor = NSColor(
                    calibratedRed: 12 / 255,
                    green: 12 / 255,
                    blue: 12 / 255,
                    alpha: 1
                )
                window.isMovableByWindowBackground = true
                applySystemLikeTrafficLightsPosition(in: window)

                // Reaplica apos o primeiro layout para evitar que o AppKit sobrescreva a posicao.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    applySystemLikeTrafficLightsPosition(in: window)
                }
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

private func applySystemLikeTrafficLightsPosition(in window: NSWindow) {
    guard
        let close = window.standardWindowButton(.closeButton),
        let mini = window.standardWindowButton(.miniaturizeButton),
        let zoom = window.standardWindowButton(.zoomButton),
        let container = close.superview
    else {
        return
    }

    let buttons = [close, mini, zoom]
    let leftInset: CGFloat = 12
    let topInset: CGFloat = 10
    let spacing: CGFloat = 6

    var x = leftInset
    for button in buttons {
        var frame = button.frame
        frame.origin.x = x
        frame.origin.y = max(0, container.bounds.height - frame.height - topInset)
        button.frame = frame
        x += frame.width + spacing
    }
}

/// Área arrastável (substitui arrastar pela barra de título).
struct WindowDragRegion: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        DragBarView()
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

private final class DragBarView: NSView {
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}
