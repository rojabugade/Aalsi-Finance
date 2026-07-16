import SwiftUI

struct SectionHeaderLink: View {
    let title: String
    var action: (() -> Void)?
    var body: some View {
        HStack {
            Text(title).font(.headline)
            Spacer()
            if let action {
                Button(action: action) { HStack(spacing: 2) { Text("View all"); Image(systemName: "chevron.right").font(.caption2.weight(.semibold)) }.font(.subheadline) }
            }
        }.padding(.horizontal, 4)
    }
}
