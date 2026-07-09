import SwiftUI

enum Caesar {
    static let ink = Color(red: 0.0, green: 0.0, blue: 0.0)
    static let inkRaised = Color(red: 0.043, green: 0.027, blue: 0.031)
    static let wineDeep = Color(red: 0.278, green: 0.0, blue: 0.059)
    static let wine = Color(red: 0.427, green: 0.0, blue: 0.102)
    static let wineLit = Color(red: 0.631, green: 0.071, blue: 0.208)
    static let wineGlow = Color(red: 0.824, green: 0.122, blue: 0.286)
    static let bone = Color.white
    static let boneDim = Color.white.opacity(0.66)
    static let boneFaint = Color.white.opacity(0.40)

    static let gain = bone
    static let loss = wineGlow
}

enum Metric {
    case up, down, flat

    init(sign decimal: Decimal) {
        if decimal > 0 { self = .up }
        else if decimal < 0 { self = .down }
        else { self = .flat }
    }

    var symbol: String {
        switch self {
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .flat: "minus"
        }
    }

    var color: Color {
        switch self {
        case .up: Caesar.gain
        case .down: Caesar.loss
        case .flat: Caesar.boneDim
        }
    }
}

enum Space {
    static let xs: CGFloat = 6
    static let sm: CGFloat = 10
    static let md: CGFloat = 16
    static let lg: CGFloat = 22
    static let xl: CGFloat = 32
}
