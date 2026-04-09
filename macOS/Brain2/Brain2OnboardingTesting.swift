//
//  Brain2OnboardingTesting.swift
//  Brain2
//
//  Regra temporária: durante testes, o onboarding ignora “já concluído” e volta a aparecer após login.
//  Definir como `false` antes do lançamento público.
//

import Foundation

enum Brain2OnboardingTesting {
    /// `true` = não grava conclusão no UserDefaults; após cada arranque o onboarding pode aparecer de novo.
    /// Na mesma sessão, após «Continuar» no passo 2, fica suprimido até reiniciar a app (evita loop e login sem overlay).
    static let alwaysShowAfterLoginPhase: Bool = true
}
