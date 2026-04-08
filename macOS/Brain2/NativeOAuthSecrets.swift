//
//  NativeOAuthSecrets.swift
//  Brain2
//
//  Os valores reais ficam em NativeOAuthSecrets.Local.swift (gitignored).
//
//  --- Google Sign-In no Mac + Firebase ---
//  O fluxo envia o id_token ao Firebase (signInWithCredential). O claim `aud` do token tem de ser
//  um OAuth client que o **Firebase Auth** aceite — em geral o **ID cliente da Web** do projeto,
//  nao um ID separado "Aplicativo para computador".
//
//  1) Firebase Console > Autenticacao > Sign-in method > Google > copie "ID cliente da Web da SDK".
//     E o ID mostrado ai (costuma comecar pelo project number do Firebase), nao outro cliente Web
//     que tenhas criado manualmente na Google Cloud com nome diferente.
//  2) Google Cloud Console > APIs e servicos > Credenciais > abra esse cliente **Web** e em
//     "URIs de redirecionamento autorizados" adicione a URI **identica** a que o app envia
//     (por defeito http://127.0.0.1:8765/ ). Se cadastrar http://localhost:8765/ , defina a mesma
//     string em googleOAuthRedirectURI no NativeOAuthSecrets.Local.swift (127.0.0.1 != localhost).
//  3) Copie a chave secreta desse mesmo cliente Web para googleOAuthClientSecret no ficheiro Local.
//
//  Se na Google Cloud nao aparece nenhum ID comecando pelo mesmo numero que o ID do Firebase:
//  - O prefixo antes do primeiro hifen e o *numero do projeto* (ex.: 695824920562-...).
//  - Um cliente "Brain2" com prefixo diferente (ex.: 38842058832-...) pertence a *outro* projeto GCP.
//  - Firebase > Definicoes do projeto > "Numeros do projeto" confirma o numero; use o link
//    "Google Cloud Platform" ou o selector de projeto no topo da Cloud Console nesse projeto.
//  - Credenciais > IDs de cliente OAuth > abra cada "Aplicativo da Web" e veja o ID completo.
//
//  Copie NativeOAuthSecrets.Local.swift.example para NativeOAuthSecrets.Local.swift e preencha.
//
//  Erro 400 redirect_uri_mismatch:
//  - Cadastre na Cloud Console a string **exata** do log [Brain2 OAuth] redirect_uri (inclui barra / no fim).
//  - 127.0.0.1 e localhost sao URIs *diferentes* para o Google; o app e a consola tem de usar a mesma.
//  - O redirect tem de estar no **mesmo** cliente OAuth cujo ID esta no Swift — abra *cada* "Aplicativo da Web"
//    na lista ate o "ID do cliente" coincidir caractere a caractere com o log. Dois clientes Web no mesmo
//    projeto (ex. "Cliente Web" vs o da Firebase) tem IDs diferentes; URI so num deles continua mismatch.
//

import Foundation

enum NativeOAuthSecrets {
    static let googleOAuthClientID = NativeOAuthSecretsLocal.googleOAuthClientID
    static let googleOAuthClientSecret = NativeOAuthSecretsLocal.googleOAuthClientSecret

    /// Redirect OAuth (autorizacao + troca de codigo). Vazio = http://127.0.0.1:8765/
    static var googleOAuthRedirectURI: String {
        let raw = NativeOAuthSecretsLocal.googleOAuthRedirectURI.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = raw.isEmpty ? GoogleDesktopOAuth.defaultRedirectURI : raw
        return base.hasSuffix("/") ? base : base + "/"
    }
}
