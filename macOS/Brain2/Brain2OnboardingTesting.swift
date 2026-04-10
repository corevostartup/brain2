//
//  Brain2OnboardingTesting.swift
//  Brain2
//
//  `alwaysShowAfterLoginPhase == true` só para debug: ignora UserDefaults e o onboarding volta após cada arranque.
//  Em produção mantém `false`: conclusão gravada em `brain2-directory-onboarding-completed` (primeiro acesso apenas).
//

import Foundation

enum Brain2OnboardingTesting {
    /// `true` = não grava conclusão no UserDefaults; útil para testar o fluxo várias vezes.
    /// `false` = após concluir o onboarding uma vez, não volta a mostrar ao abrir a app.
    static let alwaysShowAfterLoginPhase: Bool = false
}
