import SwiftUI

/// Visual identity for a spending category: an SF Symbol plus a stable tint.
/// Rows and breakdowns share this so the same category always reads the same
/// across the app. Unknown categories fall back to a hash-stable palette color
/// instead of one uniform accent, so lists stay scannable.
struct CategoryStyle {
    let symbol: String
    let color: Color

    static func style(for name: String?) -> CategoryStyle {
        guard let name, !name.isEmpty else {
            return CategoryStyle(symbol: "tag.fill", color: .gray)
        }
        let key = name.lowercased()
        for (keywords, style) in Self.table {
            if keywords.contains(where: { key.contains($0) }) {
                return style
            }
        }
        return CategoryStyle(symbol: "tag.fill", color: fallbackPalette[abs(name.hashValue) % fallbackPalette.count])
    }

    /// First keyword hit wins, so more specific groups sit above broader ones
    /// (e.g. "dining" before "food").
    private static let table: [([String], CategoryStyle)] = [
        (["dining", "restaurant", "coffee", "cafe", "takeout", "fast food"],
         CategoryStyle(symbol: "fork.knife", color: .orange)),
        (["grocer", "food", "market", "supermarket"],
         CategoryStyle(symbol: "basket.fill", color: .green)),
        (["utilit", "electric", "water", "internet", "power", "phone", "gas bill"],
         CategoryStyle(symbol: "bolt.fill", color: .yellow)),
        (["entertainment", "stream", "movie", "music", "game"],
         CategoryStyle(symbol: "play.tv.fill", color: .purple)),
        (["transport", "transit", "fuel", "gas", "car", "uber", "lyft", "parking"],
         CategoryStyle(symbol: "car.fill", color: .blue)),
        (["shopping", "retail", "clothing", "amazon"],
         CategoryStyle(symbol: "bag.fill", color: .pink)),
        (["health", "medical", "pharmacy", "fitness", "gym", "doctor"],
         CategoryStyle(symbol: "heart.fill", color: .red)),
        (["travel", "hotel", "flight", "airline", "vacation"],
         CategoryStyle(symbol: "airplane", color: .teal)),
        (["rent", "mortgage", "home", "housing"],
         CategoryStyle(symbol: "house.fill", color: .brown)),
        (["subscription", "membership"],
         CategoryStyle(symbol: "arrow.triangle.2.circlepath", color: .indigo)),
        (["income", "payroll", "salary", "paycheck", "deposit"],
         CategoryStyle(symbol: "arrow.down.left.circle.fill", color: .green)),
        (["transfer"],
         CategoryStyle(symbol: "arrow.left.arrow.right", color: .gray)),
        (["fee", "bank", "finance", "insurance", "tax"],
         CategoryStyle(symbol: "building.columns.fill", color: .cyan)),
        (["education", "school", "book", "course"],
         CategoryStyle(symbol: "graduationcap.fill", color: .mint)),
        (["pet"],
         CategoryStyle(symbol: "pawprint.fill", color: .brown)),
        (["gift", "donation", "charity"],
         CategoryStyle(symbol: "gift.fill", color: .pink)),
        (["kids", "child", "baby"],
         CategoryStyle(symbol: "figure.and.child.holdinghands", color: .mint)),
    ]

    private static let fallbackPalette: [Color] = [
        .blue, .teal, .indigo, .mint, .cyan, .purple, .orange,
    ]
}
