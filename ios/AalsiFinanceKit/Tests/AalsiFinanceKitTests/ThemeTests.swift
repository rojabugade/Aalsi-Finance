import Testing
@testable import AalsiFinanceKit

@Suite struct ThemeTests {
    @Test func rawValuesRoundTrip() {
        for mode in ThemeMode.allCases {
            #expect(ThemeMode(rawValue: mode.rawValue) == mode)
        }
        for accent in AccentChoice.allCases {
            #expect(AccentChoice(rawValue: accent.rawValue) == accent)
        }
    }

    @Test func defaultsAndLabels() {
        #expect(ThemeMode.system.label == "System")
        #expect(AccentChoice.indigo.label == "Indigo")
        #expect(AccentChoice.allCases.count == 6)
    }
}
