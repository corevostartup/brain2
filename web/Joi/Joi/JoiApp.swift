//
//  JoiApp.swift
//  Joi
//

import AppKit
import SwiftUI

@main
struct JoiApp: App {
    var body: some Scene {
        WindowGroup(id: "main") {
            ContentView()
                .background(WindowChromeConfigurator())
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1040, height: 700)

        MenuBarExtra {
            JoiMenuBarExtraContent()
        } label: {
            MenuBarJoiIconLabel()
        }
        .menuBarExtraStyle(.menu)
    }
}

// MARK: - Menu bar (ícone Joi)

/// HIG macOS: área útil do ícone na barra de menus ≈ **18×18 pt** (varia com escala; o contexto do bitmap mapeia pontos → pixeis).
private enum MenuBarIconMetrics {
    static let pointSize: CGFloat = 18
}

/// Rasteriza em **coordenadas de pontos** (não pixeis crus): usar `px` no `NSBezierPath`/`draw` cortava o desenho no contexto escalado.
private struct MenuBarJoiIconLabel: View {
    var body: some View {
        Group {
            if let image = Self.rasterizedMenuBarIcon() {
                Image(nsImage: image)
                    .interpolation(.high)
            } else {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: MenuBarIconMetrics.pointSize * 0.72, weight: .medium))
            }
        }
        .accessibilityLabel("Joi")
    }

    private static func rasterizedMenuBarIcon() -> NSImage? {
        guard let source = NSImage(named: "JoiMenuBarIcon") else { return nil }

        let screenScale = NSScreen.main?.backingScaleFactor ?? 2.0
        let points = MenuBarIconMetrics.pointSize
        let pxInt = max(1, Int((points * screenScale).rounded(.toNearestOrAwayFromZero)))

        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pxInt,
            pixelsHigh: pxInt,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ) else { return nil }

        rep.size = NSSize(width: points, height: points)

        guard let nsCtx = NSGraphicsContext(bitmapImageRep: rep) else { return nil }

        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = nsCtx
        nsCtx.imageInterpolation = .high
        defer { NSGraphicsContext.restoreGraphicsState() }

        NSColor.clear.set()
        NSBezierPath(rect: NSRect(x: 0, y: 0, width: points, height: points)).fill()

        let logical = source.size
        guard logical.width > 0, logical.height > 0 else { return nil }

        let scale = points / max(logical.width, logical.height)
        let w = logical.width * scale
        let h = logical.height * scale
        let x = (points - w) / 2
        let y = (points - h) / 2

        source.draw(
            in: NSRect(x: x, y: y, width: w, height: h),
            from: NSRect(origin: .zero, size: logical),
            operation: .sourceOver,
            fraction: 1,
            respectFlipped: false,
            hints: nil
        )

        let out = NSImage(size: NSSize(width: points, height: points))
        out.addRepresentation(rep)
        out.isTemplate = false
        return out
    }
}

private struct JoiMenuBarExtraContent: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Button("Mostrar Joi") {
            NSApp.activate(ignoringOtherApps: true)
            openWindow(id: "main")
            DispatchQueue.main.async {
                NSApp.windows
                    .filter(\.canBecomeKey)
                    .forEach { $0.makeKeyAndOrderFront(nil) }
            }
        }
        .keyboardShortcut("j", modifiers: [.command, .shift])

        Divider()

        Button("Sair do Joi") {
            NSApplication.shared.terminate(nil)
        }
    }
}
