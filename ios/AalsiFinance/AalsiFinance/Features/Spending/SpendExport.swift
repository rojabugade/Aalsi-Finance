import AalsiFinanceKit
import CoreTransferable
import SwiftUI

/// Share item for the currently filtered Activity rows. The CSV file is only
/// written when the user actually shares, and a previous export with the same
/// period name is replaced rather than accumulated.
struct SpendCSVExport: Transferable {
    let fileName: String
    private let transactions: [AalsiFinanceKit.Transaction]
    private let categoryNames: [UUID: String]

    init(
        transactions: [AalsiFinanceKit.Transaction],
        categories: [AalsiFinanceKit.Category],
        period: SpendPeriod
    ) {
        let start = APIDateParser.dateString(period.current.start)
        let end = APIDateParser.dateString(period.current.end)
        fileName = "transactions_\(start)_\(end).csv"
        self.transactions = transactions
        categoryNames = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0.name) })
    }

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .commaSeparatedText) { export in
            SentTransferredFile(try export.writeTemporaryFile())
        }
    }

    func writeTemporaryFile() throws -> URL {
        let csv = SpendCSV.export(transactions: transactions, categoryName: { categoryNames[$0] })
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try? FileManager.default.removeItem(at: url)
        try Data(csv.utf8).write(to: url, options: .atomic)
        return url
    }
}

/// Floating action bar while Activity selection mode is active. Cancel lives
/// in the top toolbar next to the selection count (where Select was), so this
/// bar carries only the primary action.
struct SpendMergeBar: View {
    let selectedCount: Int
    let isMutating: Bool
    let onMerge: () -> Void

    @State private var showsConfirmation = false

    private var isEligible: Bool { selectedCount >= 2 }

    var body: some View {
        HStack(spacing: 12) {
            Text(isEligible
                ? "Combine into one transaction"
                : "Select 2 or more to merge")
                .font(.footnote)
                .foregroundStyle(.secondary)

            Spacer()

            Button {
                showsConfirmation = true
            } label: {
                if isMutating {
                    ProgressView()
                } else {
                    Text("Merge \(selectedCount)")
                        .fontWeight(.semibold)
                }
            }
            .buttonStyle(.glassProminent)
            .disabled(!isEligible || isMutating)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .capsule)
        .padding(.horizontal, 16)
        .confirmationDialog(
            "Merge \(selectedCount) transactions?",
            isPresented: $showsConfirmation,
            titleVisibility: .visible
        ) {
            Button("Merge Transactions") {
                onMerge()
            }
        } message: {
            Text("The selected transactions are combined into a single transaction.")
        }
    }
}
