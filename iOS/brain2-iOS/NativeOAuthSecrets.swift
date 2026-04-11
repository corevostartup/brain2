//
//  NativeOAuthSecrets.swift
//  brain2-iOS
//
//  Valores reais: copie NativeOAuthSecrets.Local.swift.example → NativeOAuthSecrets.Local.swift
//  (mesmo cliente Web Firebase que no macOS; redirect iOS distinto — ver exemplo).
//

import Foundation

enum NativeOAuthSecrets {
    static let googleOAuthClientID = NativeOAuthSecretsLocal.googleOAuthClientID
    static let googleOAuthClientSecret = NativeOAuthSecretsLocal.googleOAuthClientSecret

    /// URI de redirecionamento OAuth registada na Google Cloud para este cliente Web (deve coincidir byte a byte).
    /// Por defeito: esquema personalizado aberto pela app (`brain2auth://oauth-callback`).
    static var googleOAuthRedirectURI: String {
        let raw = NativeOAuthSecretsLocal.googleOAuthRedirectURI_iOS.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty {
            return "brain2auth://oauth-callback"
        }
        return raw
    }
}
