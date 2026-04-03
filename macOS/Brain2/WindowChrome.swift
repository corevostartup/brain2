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
                window.titlebarAppearsTransparent = true
                window.titleVisibility = .hidden
                window.styleMask.insert(.fullSizeContentView)
                window.standardWindowButton(.closeButton)?.isHidden = true
                window.standardWindowButton(.miniaturizeButton)?.isHidden = true
                window.standardWindowButton(.zoomButton)?.isHidden = true
                window.isMovableByWindowBackground = true
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
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
