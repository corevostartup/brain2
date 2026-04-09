//
//  Brain2OnboardingTesting.swift
//  Brain2
//
//  Regra temporária: durante testes, o onboarding ignora “já concluído” e volta a aparecer após login.
//  Definir como `false` antes do lançamento público.
//

import Foundation

enum Brain2OnboardingTesting {
    /// `true` = não grava conclusão no UserDefaults e trata como nunca concluído (sempre pode mostrar de novo nesta fase).
    static let alwaysShowAfterLoginPhase: Bool = true
}
