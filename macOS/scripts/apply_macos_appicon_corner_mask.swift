// Ficheiro fora de `Brain2/` para o Xcode (PBXFileSystemSynchronizedRootGroup) não o compilar com o alvo.
// Aplica cantos arredondados no estilo template Apple (1024 → ratio ~224/1024) aos PNGs do AppIcon macOS.
// Uso: cd macOS && swift scripts/apply_macos_appicon_corner_mask.swift [caminho/para/imagem-1024.png]
// Sem argumento: usa Brain2/Assets.xcassets/AppIcon.appiconset/1024.png

import AppKit
import Foundation

private let cornerRadiusRatio: CGFloat = 224.0 / 1024.0

private func brain2AppDirectory() -> URL {
    let scriptDir = URL(fileURLWithPath: #file).deletingLastPathComponent()
    // .../macOS/scripts → .../macOS → .../macOS/Brain2
    let macOSDir = scriptDir.deletingLastPathComponent()
    return macOSDir.appendingPathComponent("Brain2", isDirectory: true)
}

private func assetDirectory() -> URL {
    brain2AppDirectory().appendingPathComponent("Assets.xcassets/AppIcon.appiconset", isDirectory: true)
}

private func loadCGImage(from url: URL) -> CGImage? {
    guard let ns = NSImage(contentsOf: url),
          let cg = ns.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { return nil }
    return cg
}

private func scaleToSquare(_ cgImage: CGImage, side: Int) -> CGImage? {
    let w = CGFloat(cgImage.width)
    let h = CGFloat(cgImage.height)
    let s = CGFloat(side)
    let scale = max(s / w, s / h)
    let nw = w * scale
    let nh = h * scale
    let x = (s - nw) / 2

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil,
        width: side,
        height: side,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    ctx.clear(CGRect(x: 0, y: 0, width: s, height: s))
    ctx.interpolationQuality = .high
    let drawY = (s - nh) / 2
    ctx.draw(cgImage, in: CGRect(x: x, y: drawY, width: nw, height: nh))
    return ctx.makeImage()
}

private func applyRoundedMask(_ cgImage: CGImage) -> CGImage? {
    let w = cgImage.width
    let h = cgImage.height
    let r = CGFloat(min(w, h)) * cornerRadiusRatio

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil,
        width: w,
        height: h,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    ctx.clear(CGRect(x: 0, y: 0, width: w, height: h))
    let rounded = CGPath(
        roundedRect: CGRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h)),
        cornerWidth: r,
        cornerHeight: r,
        transform: nil
    )
    ctx.addPath(rounded)
    ctx.clip()
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h)))
    return ctx.makeImage()
}

private func writePNG(_ cgImage: CGImage, size: NSSize, to url: URL) -> Bool {
    let ns = NSImage(cgImage: cgImage, size: size)
    guard let tiff = ns.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:])
    else { return false }
    do {
        try png.write(to: url, options: .atomic)
        return true
    } catch {
        return false
    }
}

private func runSipsResize(from src: String, to dest: URL, px: Int) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
    p.arguments = ["-z", "\(px)", "\(px)", src, "--out", dest.path]
    try? p.run()
    p.waitUntilExit()
}

func main() {
    let assetDir = assetDirectory()
    let defaultMaster = assetDir.appendingPathComponent("1024.png", isDirectory: false)
    let tempURL = assetDir.appendingPathComponent(".masked-master-temp.png", isDirectory: false)

    let sourceURL: URL
    if CommandLine.arguments.count > 1 {
        sourceURL = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: false)
    } else {
        sourceURL = defaultMaster
    }

    guard FileManager.default.fileExists(atPath: sourceURL.path) else {
        fputs("Ficheiro de origem inexistente: \(sourceURL.path)\n", stderr)
        exit(1)
    }

    guard var cg = loadCGImage(from: sourceURL) else {
        fputs("Não foi possível ler a imagem.\n", stderr)
        exit(1)
    }

    if cg.width != 1024 || cg.height != 1024 {
        guard let scaled = scaleToSquare(cg, side: 1024) else {
            fputs("Falha ao redimensionar para 1024×1024.\n", stderr)
            exit(1)
        }
        cg = scaled
    }

    guard let masked = applyRoundedMask(cg) else {
        fputs("Falha ao aplicar máscara.\n", stderr)
        exit(1)
    }

    guard writePNG(masked, size: NSSize(width: 1024, height: 1024), to: tempURL) else {
        fputs("Falha ao gravar PNG temporário.\n", stderr)
        exit(1)
    }

    struct OutSpec {
        let name: String
        let px: Int
    }

    let appSpecs: [OutSpec] = [
        .init(name: "16 1.png", px: 16),
        .init(name: "32.png", px: 32),
        .init(name: "32 1.png", px: 32),
        .init(name: "64.png", px: 64),
        .init(name: "128.png", px: 128),
        .init(name: "256.png", px: 256),
        .init(name: "256 1.png", px: 256),
        .init(name: "512.png", px: 512),
        .init(name: "512 1.png", px: 512),
        .init(name: "1024.png", px: 1024),
    ]

    for spec in appSpecs {
        runSipsResize(from: tempURL.path, to: assetDir.appendingPathComponent(spec.name), px: spec.px)
    }

    try? FileManager.default.removeItem(at: tempURL)

    print("AppIcon macOS: cantos arredondados aplicados (\(appSpecs.count) ficheiros).")
}

main()
