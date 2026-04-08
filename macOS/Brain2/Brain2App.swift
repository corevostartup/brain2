//
//  Brain2App.swift
//  Brain2
//
//  Created by Cássio on 03/04/26.
//

import SwiftUI

@main
struct Brain2App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        // Tamanho inicial ao abrir; o utilizador pode redimensionar livremente.
        .defaultSize(width: 2560, height: 1600)
        .windowStyle(.hiddenTitleBar)
    }
}
