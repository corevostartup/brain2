//
//  NativeOAuthSecrets.swift
//  Brain2
//
//  Preencha antes de usar "Entrar com Google" no app Mac.
//
//  1) Google Cloud Console (mesmo projeto ligado ao Firebase)
//     APIs e serviços > Credenciais > Criar credenciais > ID do cliente OAuth
//     > Tipo: "Aplicativo para computador" (Desktop).
//  2) Em "URIs de redirecionamento autorizados", adicione exatamente:
//        http://127.0.0.1:8765/
//     (porta e barra final devem coincidir com GoogleDesktopOAuth.redirectURI)
//  3) Cole o ID do cliente (termina em .apps.googleusercontent.com) abaixo.
//
//  Se o Firebase devolver credencial inválida, registe a app Apple no Firebase
//  (com.corevo.Brain2) e use o "iOS client ID" mostrado nas definições do projeto.
//

import Foundation

enum NativeOAuthSecrets {
    /// ID de cliente OAuth 2.0 (tipo Computador / Desktop), com redirect http://127.0.0.1:8765/
    static let googleOAuthDesktopClientID = "38842058832-to5ehl1im2lv00sbl3srnchf2agrasi0.apps.googleusercontent.com"
}
