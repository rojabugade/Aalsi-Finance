import SwiftUI
import AalsiFinanceKit

struct SpendFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppTheme.self) private var theme

    let categories: [AalsiFinanceKit.Category]
    let onApply: (SpendFilter) -> Void

    @State private var draft: SpendFilter

    init(
        filter: SpendFilter,
        categories: [AalsiFinanceKit.Category],
        onApply: @escaping (SpendFilter) -> Void
    ) {
        self.categories = categories
        self.onApply = onApply
        _draft = State(initialValue: filter)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Search") {
                    TextField("Merchant or notes", text: $draft.query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Search merchant or notes")
                }

                Section("Category") {
                    Picker("Parent category", selection: $draft.categoryId) {
                        Text("All categories").tag(UUID?.none)
                        ForEach(rootCategories) { category in
                            Text(category.name).tag(Optional(category.id))
                        }
                    }
                    .pickerStyle(.navigationLink)
                }

                Section("Direction") {
                    Picker("Direction", selection: $draft.direction) {
                        ForEach(SpendDirectionFilter.allCases, id: \.self) { direction in
                            Text(direction.title).tag(direction)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Amount") {
                    Picker("Amount band", selection: $draft.amountBand) {
                        ForEach(SpendAmountBand.allCases, id: \.self) { band in
                            Text(band.title).tag(band)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }

                Section("Transaction") {
                    Toggle("Recurring only", isOn: $draft.recurringOnly)

                    Picker("Status", selection: $draft.status) {
                        Text("All").tag(String?.none)
                        Text("Draft").tag(Optional("draft"))
                        Text("Confirmed").tag(Optional("confirmed"))
                        Text("Posted").tag(Optional("posted"))
                        Text("Excluded").tag(Optional("excluded"))
                    }
                    .pickerStyle(.navigationLink)
                }

                Section {
                    Button("Clear All Filters", systemImage: "arrow.counterclockwise") {
                        draft = SpendFilter()
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .accessibilityHint("Resets this draft without applying it")
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .tint(theme.accentColor)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        var applied = draft
                        applied.query = applied.query.trimmingCharacters(in: .whitespacesAndNewlines)
                        onApply(applied)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }

    private var rootCategories: [AalsiFinanceKit.Category] {
        categories
            .filter { $0.parentId == nil }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}

struct ActiveSpendFilters: View {
    @Environment(AppTheme.self) private var theme

    let filter: SpendFilter
    let categories: [AalsiFinanceKit.Category]
    let onRemove: (SpendFilter) -> Void

    init(
        filter: SpendFilter,
        categories: [AalsiFinanceKit.Category] = [],
        onRemove: @escaping (SpendFilter) -> Void
    ) {
        self.filter = filter
        self.categories = categories
        self.onRemove = onRemove
    }

    @ViewBuilder
    var body: some View {
        if !tokens.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tokens) { token in
                        Button {
                            onRemove(filter.removing(token.kind))
                        } label: {
                            HStack(spacing: 6) {
                                Text(token.label)
                                    .lineLimit(1)
                                Image(systemName: "xmark")
                                    .font(.caption2.weight(.bold))
                            }
                            .font(.caption.weight(.medium))
                            .foregroundStyle(theme.accentColor)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .background(theme.accentColor.opacity(0.12), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove \(token.label) filter")
                    }
                }
            }
            .scrollClipDisabled()
            .accessibilityLabel("Active filters")
        }
    }

    private var tokens: [ActiveFilterToken] {
        var result: [ActiveFilterToken] = []
        let query = filter.query.trimmingCharacters(in: .whitespacesAndNewlines)

        if !query.isEmpty {
            result.append(ActiveFilterToken(kind: .query, label: "Search: “\(query)”"))
        }
        if let categoryID = filter.categoryId {
            let categoryName = categories.first(where: { $0.id == categoryID })?.name ?? "Category"
            result.append(ActiveFilterToken(kind: .category, label: "Category: \(categoryName)"))
        }
        if filter.direction != .all {
            result.append(ActiveFilterToken(kind: .direction, label: "Direction: \(filter.direction.title)"))
        }
        if filter.amountBand != .any {
            result.append(ActiveFilterToken(kind: .amount, label: "Amount: \(filter.amountBand.title)"))
        }
        if filter.recurringOnly {
            result.append(ActiveFilterToken(kind: .recurring, label: "Recurring only"))
        }
        if let status = filter.status {
            result.append(ActiveFilterToken(kind: .status, label: "Status: \(status.capitalized)"))
        }
        return result
    }
}

private struct ActiveFilterToken: Identifiable {
    let kind: Kind
    let label: String

    var id: Kind { kind }

    enum Kind: Hashable {
        case query
        case category
        case direction
        case amount
        case recurring
        case status
    }
}

extension SpendFilter {
    var activeCount: Int {
        var count = 0
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { count += 1 }
        if categoryId != nil { count += 1 }
        if direction != .all { count += 1 }
        if amountBand != .any { count += 1 }
        if recurringOnly { count += 1 }
        if status != nil { count += 1 }
        return count
    }
}

private extension SpendFilter {
    func removing(_ kind: ActiveFilterToken.Kind) -> SpendFilter {
        var updated = self
        switch kind {
        case .query:
            updated.query = ""
        case .category:
            updated.categoryId = nil
        case .direction:
            updated.direction = .all
        case .amount:
            updated.amountBand = .any
        case .recurring:
            updated.recurringOnly = false
        case .status:
            updated.status = nil
        }
        return updated
    }
}

private extension SpendDirectionFilter {
    var title: String {
        switch self {
        case .all: "All"
        case .spend: "Spend"
        case .income: "Income"
        }
    }
}

private extension SpendAmountBand {
    var title: String {
        switch self {
        case .any: "Any amount"
        case .under25: "Under 25"
        case .from25To100: "25–100"
        case .from100To500: "100–500"
        case .over500: "500+"
        }
    }
}

private enum SpendFilterPreviewData {
    static let groceriesID = UUID(uuidString: "24F61670-C02E-4E46-8E75-B18B08E73746")!
    static let produceID = UUID(uuidString: "7C2941C8-E9AB-4213-AE64-A8E29B6D28F5")!

    static let categories = [
        AalsiFinanceKit.Category(id: groceriesID, parentId: nil, name: "Groceries", kind: "expense", isSystem: false),
        AalsiFinanceKit.Category(id: produceID, parentId: groceriesID, name: "Fresh Produce", kind: "expense", isSystem: false),
        AalsiFinanceKit.Category(
            id: UUID(uuidString: "118C7445-5777-42A9-8D40-61767092962E")!,
            parentId: nil,
            name: "Transportation",
            kind: "expense",
            isSystem: false
        ),
    ]

    static let active = SpendFilter(
        query: "farmers market",
        categoryId: groceriesID,
        direction: .spend,
        amountBand: .from25To100,
        recurringOnly: true,
        status: "confirmed"
    )
}

#Preview("Filters Light") {
    SpendFilterSheet(
        filter: SpendFilterPreviewData.active,
        categories: SpendFilterPreviewData.categories,
        onApply: { _ in }
    )
    .environment(AppTheme())
    .preferredColorScheme(.light)
}

#Preview("Filters Dark") {
    SpendFilterSheet(
        filter: SpendFilterPreviewData.active,
        categories: SpendFilterPreviewData.categories,
        onApply: { _ in }
    )
    .environment(AppTheme())
    .preferredColorScheme(.dark)
}

#Preview("Active Filter Tokens") {
    ActiveSpendFilters(
        filter: SpendFilterPreviewData.active,
        categories: SpendFilterPreviewData.categories,
        onRemove: { _ in }
    )
    .padding(20)
    .background(Color(.systemGroupedBackground))
    .environment(AppTheme())
    .preferredColorScheme(.light)
}
