//
//  NativeOAuthSecrets.swift
//  Brain2
//
//  Os valores reais ficam em NativeOAuthSecrets.Local.swift (gitignored).
//
//  1) Copie NativeOAuthSecrets.Local.swift.example para NativeOAuthSecrets.Local.swift
//  2) Preencha googleOAuthDesktopClientID e, se o Google exigir, googleOAuthDesktopClientSecret
//
//  Google Cloud (mesmo projeto Firebase):
//  - Credenciais > ID OAuth tipo "Aplicativo para computador" (Desktop)
//  - URI autorizado: http://127.0.0.1:8765/
//
//  Se o Firebase devolver credencial invalida, registe a app Apple no Firebase
//  (com.corevo.Brain2) conforme a documentacao do projeto.
//

import Foundation

enum NativeOAuthSecrets {
    static let googleOAuthDesktopClientID = NativeOAuthSecretsLocal.googleOAuthDesktopClientID
    static let googleOAuthDesktopClientSecret = NativeOAuthSecretsLocal.googleOAuthDesktopClientSecret
}
