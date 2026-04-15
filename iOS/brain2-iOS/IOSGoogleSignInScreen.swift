//
//  IOSGoogleSignInScreen.swift
//  brain2-iOS
//
//  Ecrã de entrada ao estilo sistema (tipografia, materiais, hierarquia Apple).
//

import SwiftUI

struct IOSGoogleSignInScreen: View {
    var isBusy: Bool
    var configurationError: String?
    var onGoogleSignIn: () -> Void
    var onContinueToWeb: () -> Void

    private var isGoogleSignInEnabled: Bool {
        configurationError == nil
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(uiColor: .systemBackground),
                    Color(uiColor: .secondarySystemBackground),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer(minLength: 24)

                VStack(spacing: 10) {
                    Text("Brain2")
                        .font(.largeTitle.weight(.semibold))
                        .foregroundStyle(.primary)

                    Text("The Extension of Your Mind")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28)
                }

                Spacer()

                VStack(spacing: 14) {
                    if let configurationError, !configurationError.isEmpty {
                        Text(configurationError)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }

                    Button(action: onGoogleSignIn) {
                        HStack(spacing: 10) {
                            if isBusy {
                                ProgressView()
                                    .tint(.primary)
                            } else {
                                googleGlyph
                            }
                            Text("Continuar com Google")
                                .font(.body.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Color.primary.opacity(0.12), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(isBusy || !isGoogleSignInEnabled)
                    .opacity(isGoogleSignInEnabled ? 1 : 0.45)

                    Button(action: onContinueToWeb) {
                        Text("Entrar na conta no site")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .disabled(isBusy)
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 36)
            }
        }
    }

    private var googleGlyph: some View {
        Text("G")
            .font(.system(size: 18, weight: .bold, design: .rounded))
            .foregroundStyle(
                LinearGradient(
                    colors: [
                        Color(red: 0.26, green: 0.52, blue: 0.96),
                        Color(red: 0.09, green: 0.64, blue: 0.29),
                        Color(red: 0.98, green: 0.74, blue: 0.02),
                        Color(red: 0.92, green: 0.25, blue: 0.21),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: 22, height: 22)
    }
}

#Preview {
    IOSGoogleSignInScreen(
        isBusy: false,
        configurationError: nil,
        onGoogleSignIn: {},
        onContinueToWeb: {}
    )
}
