import SwiftUI
import Charts

struct LineSparkline: View {
    let values: [Double]
    let color: Color
    var body: some View {
        Chart(Array(values.enumerated()), id: \.offset) { index, value in
            LineMark(x: .value("Index", index), y: .value("Value", value)).foregroundStyle(color).interpolationMethod(.catmullRom).lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
        }.chartXAxis(.hidden).chartYAxis(.hidden).chartYScale(domain: .automatic(includesZero: false))
    }
}

struct BarSparkline: View {
    let values: [Double]
    let color: Color
    var body: some View {
        Chart(Array(values.enumerated()), id: \.offset) { index, value in
            BarMark(x: .value("Index", index), y: .value("Value", value), width: .ratio(0.55)).foregroundStyle(color).cornerRadius(1.5)
        }.chartXAxis(.hidden).chartYAxis(.hidden)
    }
}
