import Foundation
import Observation
import SwiftUI

/// Shell-level UI state shared between the tab shell, the settings drawer,
/// and every page header.
@MainActor
@Observable
final class ChromeState {
    var drawerOpen = false
    var notificationsOpen = false
}
