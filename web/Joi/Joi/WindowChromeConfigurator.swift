//
//  WindowChromeConfigurator.swift
//  Joi
//

import AppKit
import SwiftUI

/// Esconde a barra de título e os semáforos nativos; a janela pode ser arrastada pelo fundo.
private final class WindowChromeHostView: NSView {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let window else { return }

        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.styleMask.insert(.fullSizeContentView)
        window.isMovableByWindowBackground = true

        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true
    }
}

struct WindowChromeConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        WindowChromeHostView()
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}
