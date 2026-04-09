//
//  DirectoryOnboardingOverlay.swift
//  Brain2
//

import AppKit
import SwiftUI

struct DirectoryOnboardingOverlay: View {
    @ObservedObject var model: DirectoryOnboardingModel

    var body: some View {
        ZStack {
            Color.black.opacity(0.55)
                .ignoresSafeArea()

            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("Escolha o Diretório")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text("Onde pretende guardar o seu vault? Pode alterar isto mais tarde nas definições.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 420)
                }

                VStack(spacing: 12) {
                    directoryOptionButton(
                        title: "Local",
                        subtitle: "Pasta no seu Mac (recomendado para começar)",
                        systemImage: "folder",
                        style: .primary
                    ) {
                        model.pickLocal()
                    }

                    directoryOptionButton(
                        title: "Cloud",
                        subtitle: "Em breve — clique para mais informação",
                        systemImage: "icloud",
                        style: .secondary
                    ) {
                        showComingSoonAlert(for: "Cloud")
                    }

                    directoryOptionButton(
                        title: "Drive",
                        subtitle: "Em breve — clique para mais informação",
                        systemImage: "externaldrive",
                        style: .secondary
                    ) {
                        showComingSoonAlert(for: "Drive")
                    }
                }
                .frame(maxWidth: 440)

                Button("Continuar mais tarde") {
                    model.markCompletedAndDismiss()
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(nsColor: .windowBackgroundColor))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.primary.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.35), radius: 28, y: 12)
            .padding(40)
        }
    }

    private enum OptionStyle {
        case primary
        case secondary
    }

    private func directoryOptionButton(
        title: String,
        subtitle: String,
        systemImage: String,
        style: OptionStyle = .primary,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: systemImage)
                    .font(.title2)
                    .frame(width: 28)
                    .foregroundStyle(style == .primary ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(Color.primary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.primary.opacity(style == .primary ? 0.1 : 0.05), lineWidth: 1)
        )
    }

    private func showComingSoonAlert(for name: String) {
        let alert = NSAlert()
        alert.messageText = "\(name) — em breve"
        alert.informativeText = "Esta opção ainda não está disponível. Utilize «Local» para escolher uma pasta no seu Mac."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
