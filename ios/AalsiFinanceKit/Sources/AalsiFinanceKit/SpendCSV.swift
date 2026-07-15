import Foundation

/// Deterministic RFC-4180-style CSV for filtered transaction exports.
public enum SpendCSV {
    public static let header = "date,merchant,category,amount,currency,status,notes"

    /// Renders transactions in the order given. Every field is quoted,
    /// embedded quotes are doubled, and embedded line breaks become spaces
    /// so one transaction is always one CSV record.
    public static func export(
        transactions: [Transaction],
        categoryName: (UUID) -> String?
    ) -> String {
        var rows = [header]
        for transaction in transactions {
            let category = transaction.categoryId.flatMap(categoryName) ?? ""
            let fields = [
                APIDateParser.dateString(transaction.txnDate),
                transaction.merchant ?? "",
                category,
                decimalString(transaction.amount.value),
                transaction.currency,
                transaction.status,
                transaction.notes ?? "",
            ]
            rows.append(fields.map(quoted).joined(separator: ","))
        }
        return rows.joined(separator: "\r\n") + "\r\n"
    }

    private static func quoted(_ field: String) -> String {
        let flattened = field
            .replacingOccurrences(of: "\r\n", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
        return "\"" + flattened.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    private static func decimalString(_ value: Decimal) -> String {
        NSDecimalNumber(decimal: value).stringValue
    }
}
