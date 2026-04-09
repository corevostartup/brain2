//
//  DirectoryOnboardingOverlay.swift
//  Brain2
//
//  Visual alinhado ao tema web (globals.css): #0c0c0c, bordas sutis, tipografia Inter-like.
//

import AppKit
import SwiftUI

/// Paleta espelhada de `web/src/app/globals.css` (tema escuro).
private enum OnboardingTheme {
    static let background = Color(red: 12 / 255, green: 12 / 255, blue: 12 / 255)
    static let cardFill = Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255)
    static let barFill = Color(red: 20 / 255, green: 20 / 255, blue: 20 / 255)
    static let foreground = Color(red: 212 / 255, green: 212 / 255, blue: 212 / 255)
    static let muted = Color(red: 136 / 255, green: 136 / 255, blue: 136 / 255)
    static let border = Color.white.opacity(0.08)
    static let borderHover = Color.white.opacity(0.12)
    static let pillBg = Color.white.opacity(0.06)
    static let accent = Color(red: 130 / 255, green: 165 / 255, blue: 255 / 255)
    static let accentSoft = Color(red: 90 / 255, green: 120 / 255, blue: 220 / 255)
}

struct DirectoryOnboardingOverlay: View {
    @ObservedObject var model: DirectoryOnboardingModel
    var dimBackground: Bool = true
    @State private var brainDisplayName: String = ""

    private var trimmedBrainDisplayName: String {
        brainDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isBrainNameFilled: Bool {
        !trimmedBrainDisplayName.isEmpty
    }

    var body: some View {
        Group {
            if model.step == .activateBrainIntro {
                ActivateBrainIntroDramaView(onComplete: { model.advanceFromBrainIntroToForm() })
                    .transition(.opacity)
            } else {
                GeometryReader { geo in
                    ZStack {
                        if dimBackground {
                            OnboardingTheme.background
                                .opacity(0.92)
                                .ignoresSafeArea()
                        }

                        ScrollView(.vertical, showsIndicators: false) {
                            VStack(spacing: 0) {
                                Spacer(minLength: 0)

                                VStack(spacing: 0) {
                                    stepBadge
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.bottom, 20)

                                    Group {
                                        switch model.step {
                                        case .chooseDirectory:
                                            chooseDirectoryContent
                                        case .activateBrainIntro:
                                            EmptyView()
                                        case .activateBrain:
                                            activateBrainContent
                                        }
                                    }
                                    .animation(.easeInOut(duration: 0.22), value: model.step)
                                }
                                .frame(maxWidth: min(520, geo.size.width - 48))
                                .padding(.horizontal, 24)
                                .padding(.vertical, 20)

                                Spacer(minLength: 0)
                            }
                            .frame(minWidth: geo.size.width)
                            .frame(minHeight: max(geo.size.height, 400))
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.4), value: model.step)
        .contentShape(Rectangle())
    }

    private var stepBadge: some View {
        HStack(spacing: 10) {
            Text(model.step == .chooseDirectory ? "Passo 1 de 2" : "Passo 2 de 2")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .tracking(0.6)
                .textCase(.uppercase)
                .foregroundStyle(OnboardingTheme.muted)

            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(OnboardingTheme.pillBg)
                .frame(width: 64, height: 4)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(OnboardingTheme.accent)
                        .frame(width: model.step == .chooseDirectory ? 32 : 64, height: 4)
                        .animation(.easeInOut(duration: 0.25), value: model.step)
                }
        }
    }

    private var chooseDirectoryContent: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Escolha o diretório")
                    .font(.system(size: 26, weight: .semibold, design: .default))
                    .foregroundStyle(OnboardingTheme.foreground)

                Text("Onde você quer guardar o vault? Você pode mudar depois em Ajustes.")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(OnboardingTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)
            }

            VStack(spacing: 10) {
                optionRow(
                    title: "Local",
                    subtitle: "Pasta no Mac — recomendado para começar",
                    icon: "folder.fill",
                    isPrimary: true,
                    isSelected: model.storageChoice == .local,
                    action: { model.selectLocalStorage() }
                )
                optionRow(
                    title: "Nuvem",
                    subtitle: "Em breve",
                    icon: "icloud.fill",
                    isPrimary: false,
                    isSelected: false,
                    action: { showComingSoonAlert(título: "Nuvem") }
                )
                optionRow(
                    title: "Drive",
                    subtitle: "Em breve",
                    icon: "externaldrive.fill",
                    isPrimary: false,
                    isSelected: false,
                    action: { showComingSoonAlert(título: "Drive") }
                )
            }

            if model.storageChoice == .local {
                primaryButton(title: "Seguinte") {
                    model.pickLocal()
                }
            }
        }
        .padding(28)
        .background(cardChrome)
    }

    private var activateBrainContent: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Um nome para o centro")
                    .font(.system(size: 26, weight: .semibold, design: .default))
                    .foregroundStyle(OnboardingTheme.foreground)

                (
                    Text("Este nome é o ")
                        + Text("eixo").fontWeight(.semibold).foregroundStyle(OnboardingTheme.foreground.opacity(0.92))
                        + Text(" do teu vault: é a partir dele que as pastas na raiz e as tuas ideias se organizam e se ligam. Uma escolha clara torna a navegação mais intuitiva à medida que o cérebro cresce.")
                )
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(OnboardingTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(4)

                (
                    Text("Recomendamos ")
                        + Text("o teu próprio nome").fontWeight(.semibold).foregroundStyle(OnboardingTheme.foreground.opacity(0.92))
                        + Text(" (ou como preferes ser tratado): o centro fica inequivocamente teu e alinha o Brain2 à forma como pensas.")
                )
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(OnboardingTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(4)

                Text("Podes alterar o nome mais tarde em Ajustes, mas este primeiro passo define a identidade do teu espaço.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OnboardingTheme.muted.opacity(0.92))
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Nome da pasta-central (obrigatório)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OnboardingTheme.muted)

                Text("No disco: raiz do vault escolhido → pasta com este nome → ficheiro com o mesmo nome e extensão .md dentro dela.")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(OnboardingTheme.muted.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(2)

                TextField("", text: $brainDisplayName, prompt: Text("Ex.: o teu nome").foregroundStyle(OnboardingTheme.muted.opacity(0.7)))
                    .textFieldStyle(.plain)
                    .font(.system(size: 16, weight: .regular))
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(OnboardingTheme.barFill)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(OnboardingTheme.border, lineWidth: 1)
                            )
                    )
                    .onSubmit {
                        if isBrainNameFilled {
                            model.markCompletedAndDismiss(brainCentralFolderName: trimmedBrainDisplayName)
                        }
                    }
            }

            HStack(alignment: .center, spacing: 12) {
                secondaryButton(title: "Voltar") {
                    model.goBackToChooseDirectory()
                }
                .fixedSize(horizontal: true, vertical: false)

                primaryButton(title: "Continuar", disabled: !isBrainNameFilled) {
                    model.markCompletedAndDismiss(brainCentralFolderName: trimmedBrainDisplayName)
                }
                .layoutPriority(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(28)
        .background(cardChrome)
    }

    private var cardChrome: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(OnboardingTheme.cardFill)
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [
                                OnboardingTheme.borderHover.opacity(0.9),
                                OnboardingTheme.border.opacity(0.35),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(color: .black.opacity(0.45), radius: 40, y: 20)
    }

    private func optionRow(
        title: String,
        subtitle: String,
        icon: String,
        isPrimary: Bool,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(isPrimary ? OnboardingTheme.accent.opacity(0.12) : OnboardingTheme.pillBg)
                        .frame(width: 44, height: 44)
                    Image(systemName: icon)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(isPrimary ? OnboardingTheme.accent : OnboardingTheme.muted)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(OnboardingTheme.foreground)
                    Text(subtitle)
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(OnboardingTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Image(systemName: isSelected ? "checkmark.circle.fill" : "chevron.right")
                    .font(.system(size: isSelected ? 18 : 12, weight: .semibold))
                    .foregroundStyle(isSelected ? OnboardingTheme.accent : OnboardingTheme.muted.opacity(0.45))
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(OnboardingTheme.barFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(
                                isSelected ? OnboardingTheme.accent.opacity(0.55) : (isPrimary ? OnboardingTheme.accent.opacity(0.22) : OnboardingTheme.border),
                                lineWidth: isSelected ? 2 : 1
                            )
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func primaryButton(title: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [OnboardingTheme.accentSoft, OnboardingTheme.accent],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                )
        }
        .buttonStyle(.plain)
        .frame(minHeight: 48)
        .contentShape(Rectangle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }

    private func secondaryButton(title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(OnboardingTheme.foreground)
                .frame(minWidth: 108)
                .padding(.vertical, 14)
                .padding(.horizontal, 18)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(OnboardingTheme.pillBg)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(OnboardingTheme.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
    }

    private func showComingSoonAlert(título: String) {
        let alert = NSAlert()
        alert.messageText = "\(título) — em breve"
        alert.informativeText = "Essa opção ainda não está disponível. Use «Local» para escolher uma pasta no Mac."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}

// MARK: - Drama «Ative o seu cérebro» (splash antes do formulário)

private struct ActivateBrainIntroDramaView: View {
    let onComplete: () -> Void

    @State private var auraPulse = false
    @State private var titlePhase = false
    @State private var subtitlePhase = false
    @State private var shineOpacity: Double = 0

    var body: some View {
        ZStack {
            OnboardingTheme.background
                .ignoresSafeArea()

            Ellipse()
                .fill(
                    RadialGradient(
                        colors: [
                            Color.white.opacity(0.08),
                            Color.white.opacity(0.025),
                            Color.clear,
                        ],
                        center: .center,
                        startRadius: 20,
                        endRadius: 320
                    )
                )
                .frame(width: 780, height: 520)
                .blur(radius: 56)
                .offset(y: -48)
                .scaleEffect(auraPulse ? 1.07 : 1.0)
                .rotationEffect(.degrees(auraPulse ? 2 : 0))
                .animation(.easeInOut(duration: 7).repeatForever(autoreverses: true), value: auraPulse)

            RadialGradient(
                colors: [Color.clear, Color.black.opacity(0.42)],
                center: .center,
                startRadius: 80,
                endRadius: 480
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 18) {
                ZStack(alignment: .bottom) {
                    Text("Ative o seu cérebro")
                        .font(.system(size: 30, weight: .medium, design: .default))
                        .tracking(1.2)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(
                            LinearGradient(
                                colors: [
                                    OnboardingTheme.foreground,
                                    OnboardingTheme.foreground.opacity(0.88),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .opacity(titlePhase ? 1 : 0)
                        .offset(y: titlePhase ? 0 : 22)
                        .blur(radius: titlePhase ? 0 : 10)
                        .scaleEffect(titlePhase ? 1 : 0.97)

                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.clear,
                                    Color.white.opacity(0.14),
                                    Color.clear,
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: 220, height: 1)
                        .offset(y: 10)
                        .opacity(shineOpacity)
                }
                .padding(.horizontal, 24)

                Text("O centro onde tudo se liga")
                    .font(.system(size: 11, weight: .light, design: .default))
                    .tracking(0.28)
                    .textCase(.uppercase)
                    .foregroundStyle(OnboardingTheme.muted)
                    .opacity(subtitlePhase ? 1 : 0)
                    .offset(y: subtitlePhase ? 0 : 12)
            }
            .padding(32)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Ative o seu cérebro. A preparar o passo seguinte.")
        .onAppear {
            auraPulse = true
            withAnimation(.spring(response: 1.12, dampingFraction: 0.86, blendDuration: 0.15)) {
                titlePhase = true
            }
            withAnimation(.easeOut(duration: 0.85).delay(0.42)) {
                shineOpacity = 1
            }
            withAnimation(.spring(response: 0.95, dampingFraction: 0.88).delay(0.38)) {
                subtitlePhase = true
            }
        }
        .task {
            try? await Task.sleep(nanoseconds: 2_350_000_000)
            await MainActor.run {
                onComplete()
            }
        }
    }
}
