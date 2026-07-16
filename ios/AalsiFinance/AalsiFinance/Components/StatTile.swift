import SwiftUI

struct StatTile<Accessory: View>: View {
    let title: String
    let value: String
    var caption: String?
    var captionColor: Color = .secondary
    @ViewBuilder var accessory: Accessory

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.headline).fontDesign(.rounded).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            if let caption { Text(caption).font(.caption2).foregroundStyle(captionColor).lineLimit(1) }
            Spacer(minLength: 2)
            accessory
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
