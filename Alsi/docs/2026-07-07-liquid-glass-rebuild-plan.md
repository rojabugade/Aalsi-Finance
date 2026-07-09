# Alsi Liquid Glass Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Alsi iOS app from the ground up on Apple's native Liquid Glass (iOS 27+), with a clean feature-module architecture, the CAESAR (black/burgundy/white) identity, and Dashboard + Spend as real screens.

**Architecture:** SwiftUI + Observation (`@Observable`). The system renders glass chrome for free (native `TabView`/`Tab`, `NavigationStack`/`.toolbar`); custom `.glassEffect` is reserved for ~2 hero surfaces per screen inside a `GlassEffectContainer`. Core is UI-free (Foundation only); presentation/tints live in the feature + design layers. The Xcode project uses a file-system-synchronized root group so file references never rot.

**Tech Stack:** Swift, SwiftUI, Observation framework, Swift Testing, Keychain Services, `xcodebuild`.

## Global Constraints

- Minimum deployment target: **iOS 27.0**. Use native Liquid Glass APIs directly; **no** `if #available` fallbacks.
- `Core/` files import **Foundation only** — never `SwiftUI`. No `Color`/`View` in models.
- Custom glass only via `.glassEffect(.regular.tint(_).interactive(), in:)` inside a `GlassEffectContainer`; **never** put custom backgrounds on `TabView`, `NavigationStack`, `.toolbar`, or sheets.
- CAESAR palette only. Anchors: ink `#000000`, wine `#6D001A`, bone `#FFFFFF`. Gains render bone-white, losses render wine-glow `#D21F49`, with ▲/▼. No green.
- JWT stored in **Keychain**, never `UserDefaults`. Base URL may live in `UserDefaults`.
- Backend base URL default: `http://localhost:8000`. Auth header `Authorization: Bearer <token>`; `401` → sign out.
- Bundle identifier: `com.alsi.app`. App display name: `Alsi`.
- Commit after every task with a Conventional Commit message ending:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

```
Alsi/
  Alsi.xcodeproj/project.pbxproj          synchronized-group project (regenerated)
  .gitignore
  Alsi/                                    app target (synchronized root group)
    App/AlsiApp.swift                      @main; builds + injects FinanceStore
    App/RootView.swift                     TabView { Tab } + backdrop
    DesignSystem/Theme.swift               CAESAR tokens, type scale, spacing
    DesignSystem/Background.swift          burgundy-bloom backdrop
    DesignSystem/GlassSurfaces.swift       heroGlass()/pillGlass() custom-glass modifiers
    Core/Models/MoneyValue.swift           lenient Decimal decode
    Core/Models/Cashflow.swift             CashflowSummary, CashflowLine
    Core/Models/Transaction.swift          Transaction, LineItem
    Core/Models/ReviewQueue.swift          ReviewQueue, ReviewGroup, ReviewItem
    Core/Models/RecurringSeries.swift      RecurringSeries
    Core/Models/Budget.swift               Budget
    Core/Models/NetWorth.swift             NetWorth
    Core/Models/FinanceSnapshot.swift      aggregate + derived counts (no UI)
    Core/Formatting/FinanceFormatter.swift currency/percent/date strings
    Core/Networking/APIError.swift         FinanceAPIError
    Core/Networking/APIClient.swift        generic request<Body,Response>
    Core/Networking/FinanceService.swift   endpoints + parallel fetchSnapshot()
    Core/Auth/KeychainStore.swift          token read/write/delete
    Core/State/FinanceStore.swift          @Observable session + snapshot
    Features/Dashboard/DashboardView.swift + DashboardMetric.swift
    Features/Spend/SpendView.swift
    Features/Placeholder/ComingSoonView.swift
    Features/Auth/SignInSheet.swift
    Features/Shared/StateCards.swift       LoadingCard/ErrorCard/EmptyCard
    Assets.xcassets/                       AccentColor, AppIcon (kept)
  AlsiTests/                               unit-test target (synchronized root group)
    ModelDecodingTests.swift
    APIClientTests.swift
    SnapshotTests.swift
```

---

## Task 1: Reset and regenerate the Xcode project

**Files:**
- Delete: `Alsi/.git`, `Alsi/.DerivedData`, `Alsi/Alsi/AlsiApp.swift` (old), `Alsi/Alsi/ContentView.swift`, `Alsi/Alsi/GlassCard.swift`, `Alsi/Alsi/GlassEffectCompat.swift`, `Alsi/Alsi/HomeView.swift`, entire old `Alsi/Alsi/App|Core|DesignSystem|Features` half-migration.
- Keep: `Alsi/Alsi/Assets.xcassets`, `Alsi/.gitignore`, `Alsi/docs/`.
- Create: `Alsi/Alsi.xcodeproj/project.pbxproj` (replace), `Alsi/Alsi/App/AlsiApp.swift`, `Alsi/Alsi/App/RootView.swift`, `Alsi/AlsiTests/SmokeTests.swift`.

**Interfaces:**
- Produces: an `Alsi` app scheme and an `AlsiTests` target that build against iOS 27; `AlsiApp` `@main` entry; a temporary `RootView` placeholder replaced in Task 8.

- [ ] **Step 1: Wipe the mess**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
rm -rf .git .DerivedData
rm -rf Alsi/App Alsi/Core Alsi/DesignSystem Alsi/Features
rm -f Alsi/AlsiApp.swift Alsi/ContentView.swift Alsi/GlassCard.swift Alsi/GlassEffectCompat.swift Alsi/HomeView.swift
mkdir -p Alsi/App Alsi/DesignSystem Alsi/Core/Models Alsi/Core/Formatting Alsi/Core/Networking Alsi/Core/Auth Alsi/Core/State Alsi/Features/Dashboard Alsi/Features/Spend Alsi/Features/Placeholder Alsi/Features/Auth Alsi/Features/Shared AlsiTests
ls -R Alsi | head -40
```

Expected: the old flat/half-migrated files are gone; `Alsi/Assets.xcassets` remains; new empty dirs exist.

- [ ] **Step 2: Write the minimal app entry so the project has something to compile**

Create `Alsi/App/AlsiApp.swift`:

```swift
import SwiftUI

@main
struct AlsiApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
```

Create `Alsi/App/RootView.swift` (temporary; replaced in Task 8):

```swift
import SwiftUI

struct RootView: View {
    var body: some View {
        Text("Alsi")
            .font(.largeTitle)
    }
}

#Preview {
    RootView()
}
```

- [ ] **Step 3: Write a smoke test**

Create `AlsiTests/SmokeTests.swift`:

```swift
import Testing

@Test func smoke() {
    #expect(1 + 1 == 2)
}
```

- [ ] **Step 4: Write the synchronized-group project file**

Replace `Alsi/Alsi.xcodeproj/project.pbxproj` with exactly:

```
// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 77;
	objects = {

/* Begin PBXFileReference section */
		AA0000000000000000000APP /* Alsi.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Alsi.app; sourceTree = BUILT_PRODUCTS_DIR; };
		AA0000000000000000TESTS /* AlsiTests.xctest */ = {isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = AlsiTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */

/* Begin PBXFileSystemSynchronizedRootGroup section */
		AA000000000000000SRCGRP /* Alsi */ = {isa = PBXFileSystemSynchronizedRootGroup; path = Alsi; sourceTree = "<group>"; };
		AA00000000000000TESTGRP /* AlsiTests */ = {isa = PBXFileSystemSynchronizedRootGroup; path = AlsiTests; sourceTree = "<group>"; };
/* End PBXFileSystemSynchronizedRootGroup section */

/* Begin PBXFrameworksBuildPhase section */
		AA00000000000000APPFRM = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
		AA0000000000000TESTFRM = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		AA0000000000000MAINGRP = {isa = PBXGroup; children = (AA000000000000000SRCGRP, AA00000000000000TESTGRP, AA0000000000000PRODGRP, ); sourceTree = "<group>"; };
		AA0000000000000PRODGRP /* Products */ = {isa = PBXGroup; children = (AA0000000000000000000APP, AA0000000000000000TESTS, ); name = Products; sourceTree = "<group>"; };
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		AA0000000000000APPTGT /* Alsi */ = {isa = PBXNativeTarget; buildConfigurationList = AA000000000APPCFGLIST; buildPhases = (AA00000000000APPSRC, AA00000000000000APPFRM, AA00000000000APPRES, ); buildRules = (); dependencies = (); fileSystemSynchronizedGroups = (AA000000000000000SRCGRP, ); name = Alsi; productName = Alsi; productReference = AA0000000000000000000APP; productType = "com.apple.product-type.application"; };
		AA000000000000TESTTGT /* AlsiTests */ = {isa = PBXNativeTarget; buildConfigurationList = AA00000000TESTCFGLIST; buildPhases = (AA0000000000TESTSRC, AA0000000000000TESTFRM, ); buildRules = (); dependencies = (AA00000000TESTTGTDEP, ); fileSystemSynchronizedGroups = (AA00000000000000TESTGRP, ); name = AlsiTests; productName = AlsiTests; productReference = AA0000000000000000TESTS; productType = "com.apple.product-type.bundle.unit-test"; };
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		AA0000000000000PROJECT = {isa = PBXProject; attributes = {BuildIndependentTargetsInParallel = 1; LastSwiftUpdateCheck = 2700; LastUpgradeCheck = 2700; TargetAttributes = {AA0000000000000APPTGT = {CreatedOnToolsVersion = 27.0; }; AA000000000000TESTTGT = {CreatedOnToolsVersion = 27.0; TestTargetID = AA0000000000000APPTGT; }; }; }; buildConfigurationList = AA00000000PROJCFGLIST; compatibilityVersion = "Xcode 16.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base, ); mainGroup = AA0000000000000MAINGRP; productRefGroup = AA0000000000000PRODGRP; projectDirPath = ""; projectRoot = ""; targets = (AA0000000000000APPTGT, AA000000000000TESTTGT, ); };
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		AA00000000000APPRES = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		AA00000000000APPSRC = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
		AA0000000000TESTSRC = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXSourcesBuildPhase section */

/* Begin PBXTargetDependency section */
		AA00000000TESTTGTDEP = {isa = PBXTargetDependency; target = AA0000000000000APPTGT; targetProxy = AA000000TESTTGTPROXY; };
/* End PBXTargetDependency section */

/* Begin PBXContainerItemProxy section */
		AA000000TESTTGTPROXY = {isa = PBXContainerItemProxy; containerPortal = AA0000000000000PROJECT; proxyType = 1; remoteGlobalIDString = AA0000000000000APPTGT; remoteInfo = Alsi; };
/* End PBXContainerItemProxy section */

/* Begin XCBuildConfiguration section */
		AA0000000000PROJDEBUG /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {ALWAYS_SEARCH_USER_PATHS = NO; CLANG_ENABLE_MODULES = YES; ENABLE_STRICT_OBJC_MSGSEND = YES; GCC_C_LANGUAGE_STANDARD = gnu17; IPHONEOS_DEPLOYMENT_TARGET = 27.0; SDKROOT = iphoneos; SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG $(inherited)"; SWIFT_OPTIMIZATION_LEVEL = "-Onone"; SWIFT_VERSION = 6.0; }; name = Debug; };
		AA000000000PROJRELEASE /* Release */ = {isa = XCBuildConfiguration; buildSettings = {ALWAYS_SEARCH_USER_PATHS = NO; CLANG_ENABLE_MODULES = YES; ENABLE_STRICT_OBJC_MSGSEND = YES; GCC_C_LANGUAGE_STANDARD = gnu17; IPHONEOS_DEPLOYMENT_TARGET = 27.0; SDKROOT = iphoneos; SWIFT_COMPILATION_MODE = wholemodule; SWIFT_VERSION = 6.0; VALIDATE_PRODUCT = YES; }; name = Release; };
		AA00000000000APPDEBUG /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor; CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; ENABLE_PREVIEWS = YES; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_UILaunchScreen_Generation = YES; INFOPLIST_KEY_UISupportedInterfaceOrientations = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"; MARKETING_VERSION = 1.0; PRODUCT_BUNDLE_IDENTIFIER = com.alsi.app; PRODUCT_NAME = "$(TARGET_NAME)"; SWIFT_EMIT_LOC_STRINGS = YES; SWIFT_VERSION = 6.0; TARGETED_DEVICE_FAMILY = "1,2"; }; name = Debug; };
		AA0000000000APPRELEASE /* Release */ = {isa = XCBuildConfiguration; buildSettings = {ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor; CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; ENABLE_PREVIEWS = YES; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_UILaunchScreen_Generation = YES; INFOPLIST_KEY_UISupportedInterfaceOrientations = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"; MARKETING_VERSION = 1.0; PRODUCT_BUNDLE_IDENTIFIER = com.alsi.app; PRODUCT_NAME = "$(TARGET_NAME)"; SWIFT_EMIT_LOC_STRINGS = YES; SWIFT_VERSION = 6.0; TARGETED_DEVICE_FAMILY = "1,2"; }; name = Release; };
		AA000000000TESTDEBUG /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {BUNDLE_LOADER = "$(TEST_HOST)"; GENERATE_INFOPLIST_FILE = YES; IPHONEOS_DEPLOYMENT_TARGET = 27.0; PRODUCT_BUNDLE_IDENTIFIER = com.alsi.app.tests; PRODUCT_NAME = "$(TARGET_NAME)"; SWIFT_VERSION = 6.0; TARGETED_DEVICE_FAMILY = "1,2"; TEST_HOST = "$(BUILT_PRODUCTS_DIR)/Alsi.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Alsi"; }; name = Debug; };
		AA00000000TESTRELEASE /* Release */ = {isa = XCBuildConfiguration; buildSettings = {BUNDLE_LOADER = "$(TEST_HOST)"; GENERATE_INFOPLIST_FILE = YES; IPHONEOS_DEPLOYMENT_TARGET = 27.0; PRODUCT_BUNDLE_IDENTIFIER = com.alsi.app.tests; PRODUCT_NAME = "$(TARGET_NAME)"; SWIFT_VERSION = 6.0; TARGETED_DEVICE_FAMILY = "1,2"; TEST_HOST = "$(BUILT_PRODUCTS_DIR)/Alsi.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Alsi"; }; name = Release; };
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		AA00000000PROJCFGLIST = {isa = XCConfigurationList; buildConfigurations = (AA0000000000PROJDEBUG, AA000000000PROJRELEASE, ); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
		AA000000000APPCFGLIST = {isa = XCConfigurationList; buildConfigurations = (AA00000000000APPDEBUG, AA0000000000APPRELEASE, ); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
		AA00000000TESTCFGLIST = {isa = XCConfigurationList; buildConfigurations = (AA000000000TESTDEBUG, AA00000000TESTRELEASE, ); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };
/* End XCConfigurationList section */
	};
	rootObject = AA0000000000000PROJECT;
}
```

- [ ] **Step 5: Create a shared scheme so `xcodebuild -scheme Alsi` resolves**

Create `Alsi/Alsi.xcodeproj/xcshareddata/xcschemes/Alsi.xcscheme`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.7">
   <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">
            <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="AA0000000000000APPTGT" BuildableName="Alsi.app" BlueprintName="Alsi" ReferencedContainer="container:Alsi.xcodeproj"></BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">
      <Testables>
         <TestableReference skipped="NO">
            <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="AA000000000000TESTTGT" BuildableName="AlsiTests.xctest" BlueprintName="AlsiTests" ReferencedContainer="container:Alsi.xcodeproj"></BuildableReference>
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES">
      <BuildableProductRunnable runnableDebuggingMode="0">
         <BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="AA0000000000000APPTGT" BuildableName="Alsi.app" BlueprintName="Alsi" ReferencedContainer="container:Alsi.xcodeproj"></BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
</Scheme>
```

- [ ] **Step 6: Verify the toolchain and project resolve**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild -version
xcodebuild -list -project Alsi.xcodeproj
```

Expected: `xcodebuild -version` prints an Xcode version (NOT "requires Xcode"). `-list` shows targets `Alsi`, `AlsiTests` and scheme `Alsi`.

**If `xcodebuild -version` errors (only Command Line Tools installed):** stop and report to the user — a full Xcode with an iOS 27 simulator is required to build/verify. Continue authoring the remaining source (it is compile-correct by construction), and hand build/run verification to the user. Note this in the task's completion summary.

- [ ] **Step 7: Verify a build (only if Step 6 succeeded)**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild -scheme Alsi -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -20
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 8: Commit**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
git init -q
git add -A
git commit -q -m "chore: reset Alsi project on synchronized-group Xcode config (iOS 27)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: the reset removed the old nested repo per spec. This re-inits a fresh local repo purely for atomic task commits; it is not tracked by the parent project.

---

## Task 2: CAESAR design tokens

**Files:**
- Create: `Alsi/DesignSystem/Theme.swift`

**Interfaces:**
- Produces: `enum Caesar` with static `Color`s: `ink`, `inkRaised`, `wineDeep`, `wine`, `wineLit`, `wineGlow`, `bone`, `boneDim`, `boneFaint`; `Caesar.gain` (= `bone`), `Caesar.loss` (= `wineGlow`); `enum Metric { case up, down, flat; var symbol: String; var color: Color }`; spacing constants `Space.{xs,sm,md,lg,xl}`.

- [ ] **Step 1: Write the tokens**

Create `Alsi/DesignSystem/Theme.swift`:

```swift
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild -scheme Alsi -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5
```

Expected: `** BUILD SUCCEEDED **` (or, if no full Xcode, skip and rely on final verification).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -q -m "feat: add CAESAR design tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backdrop and custom-glass modifiers

**Files:**
- Create: `Alsi/DesignSystem/Background.swift`, `Alsi/DesignSystem/GlassSurfaces.swift`

**Interfaces:**
- Consumes: `Caesar` (Task 2).
- Produces: `struct CaesarBackground: View`; `View.heroGlass(cornerRadius:) -> some View` and `View.pillGlass() -> some View` that wrap `.glassEffect(.regular.tint(...).interactive(), in:)`.

- [ ] **Step 1: Write the backdrop**

Create `Alsi/DesignSystem/Background.swift`:

```swift
import SwiftUI

struct CaesarBackground: View {
    var body: some View {
        ZStack {
            Caesar.ink

            RadialGradient(
                colors: [Caesar.wine.opacity(0.55), Caesar.wineDeep.opacity(0.30), .clear],
                center: .init(x: 0.5, y: -0.05),
                startRadius: 8,
                endRadius: 520
            )

            RadialGradient(
                colors: [Caesar.wineLit.opacity(0.16), .clear],
                center: .init(x: 0.9, y: 0.9),
                startRadius: 8,
                endRadius: 420
            )

            Canvas { context, size in
                var path = Path()
                let spacing: CGFloat = 40
                var x: CGFloat = -size.height
                while x < size.width + size.height {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x + size.height, y: size.height))
                    x += spacing
                }
                context.stroke(path, with: .color(.white.opacity(0.03)), lineWidth: 0.6)
            }
            .blendMode(.plusLighter)
        }
        .ignoresSafeArea()
    }
}
```

- [ ] **Step 2: Write the custom-glass modifiers**

Create `Alsi/DesignSystem/GlassSurfaces.swift`:

```swift
import SwiftUI

extension View {
    /// Hero surface — the one big custom-glass card per screen. Tinted oxblood.
    func heroGlass(cornerRadius: CGFloat = 28) -> some View {
        self
            .padding(Space.lg)
            .glassEffect(
                .regular.tint(Caesar.wine.opacity(0.55)).interactive(),
                in: .rect(cornerRadius: cornerRadius)
            )
    }

    /// Floating pill — filters / small actions.
    func pillGlass() -> some View {
        self
            .padding(.horizontal, Space.md)
            .padding(.vertical, Space.sm)
            .glassEffect(
                .regular.tint(Caesar.wineLit.opacity(0.40)).interactive(),
                in: .capsule
            )
    }
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild -scheme Alsi -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5
git add -A && git commit -q -m "feat: add CAESAR backdrop and custom-glass surface modifiers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Core models + formatter (with decoding tests)

**Files:**
- Create: `Alsi/Core/Models/MoneyValue.swift`, `Cashflow.swift`, `Transaction.swift`, `ReviewQueue.swift`, `RecurringSeries.swift`, `Budget.swift`, `NetWorth.swift`, `FinanceSnapshot.swift`, `Alsi/Core/Formatting/FinanceFormatter.swift`
- Test: `AlsiTests/ModelDecodingTests.swift`

**Interfaces:**
- Produces (Foundation-only, no SwiftUI):
  - `struct MoneyValue: Decodable, Hashable { let decimal: Decimal; init(_:) }`
  - `struct CashflowSummary: Decodable { currency; incomeMonthly; recurringMonthly; debtEmiMonthly; cardMinMonthly; discretionaryMonthly; leftoverMonthly: MoneyValue; breakdown: [CashflowLine] }`, `struct CashflowLine: Decodable, Identifiable { label, kind: String; amount: MoneyValue }`
  - `struct Transaction: Decodable, Identifiable { id; merchant?; amount: MoneyValue; currency; txnDate; status; sourceChannel?; lineItems: [LineItem]; var displayName; var isDraft }`, `struct LineItem: Decodable, Identifiable { id, name; amount }`
  - `struct ReviewQueue: Decodable { groups; items; static empty; var pendingCount }`, `ReviewGroup`, `ReviewItem`
  - `struct RecurringSeries: Decodable, Identifiable { id, name; amount?; currency; cadence; type; status; nextDueDate?; merchantName?; categoryName? }`
  - `struct Budget: Decodable, Identifiable { id; amount; currency; spent; remaining; progressPct: MoneyValue; overspent: Bool }`
  - `struct NetWorth: Decodable { currency; assets; liabilities; netWorth: MoneyValue }`
  - `struct FinanceSnapshot { cashflow?; transactions; reviewQueue; recurringSeries; budgets; netWorth?; static empty; var currency; var draftTransactionCount; var pendingReviewCount; var hasLiveData }`
  - `enum FinanceFormatter { static func currency(_:currency:signed:); static func percent(_:); static func shortDate(_:) }`

- [ ] **Step 1: Write the failing decoding tests**

Create `AlsiTests/ModelDecodingTests.swift`:

```swift
import Testing
import Foundation
@testable import Alsi

@Suite struct ModelDecodingTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    @Test func moneyValueAcceptsNumberAndString() throws {
        let a = try decode(MoneyValue.self, "12.50")
        let b = try decode(MoneyValue.self, "\"12.50\"")
        #expect(a.decimal == Decimal(string: "12.50"))
        #expect(b.decimal == Decimal(string: "12.50"))
    }

    @Test func cashflowMapsSnakeCase() throws {
        let json = """
        {"currency":"USD","income_monthly":"5000","recurring_monthly":"1200",
         "debt_emi_monthly":"300","card_min_monthly":"100","discretionary_monthly":"900",
         "leftover_monthly":"2500","breakdown":[{"label":"Rent","amount":"1000","kind":"recurring"}]}
        """
        let c = try decode(CashflowSummary.self, json)
        #expect(c.currency == "USD")
        #expect(c.leftoverMonthly.decimal == 2500)
        #expect(c.breakdown.first?.kind == "recurring")
    }

    @Test func transactionExposesDraftAndDisplayName() throws {
        let json = """
        {"id":"t1","merchant":"","amount":"-9.99","currency":"USD","txn_date":"2026-07-01",
         "status":"draft","source_channel":"gmail","line_items":[]}
        """
        let t = try decode(Transaction.self, json)
        #expect(t.isDraft)
        #expect(t.displayName == "Gmail")
    }

    @Test func snapshotCountsDrafts() throws {
        let t = try decode(Transaction.self,
            "{\"id\":\"t1\",\"amount\":\"1\",\"currency\":\"USD\",\"txn_date\":\"2026-07-01\",\"status\":\"draft\",\"line_items\":[]}")
        let snap = FinanceSnapshot(cashflow: nil, transactions: [t], reviewQueue: .empty,
                                   recurringSeries: [], budgets: [], netWorth: nil)
        #expect(snap.draftTransactionCount == 1)
        #expect(snap.currency == "USD")
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild test -scheme Alsi -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | tail -20
```

Expected: FAIL — types `MoneyValue`, `CashflowSummary`, `Transaction`, `FinanceSnapshot` not found.
(Adjust the simulator name to one that exists: `xcrun simctl list devices available`.)

- [ ] **Step 3: Write `MoneyValue`**

Create `Alsi/Core/Models/MoneyValue.swift`:

```swift
import Foundation

struct MoneyValue: Decodable, Hashable {
    let decimal: Decimal

    init(_ decimal: Decimal) { self.decimal = decimal }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Decimal.self) { decimal = d }
        else if let s = try? c.decode(String.self), let d = Decimal(string: s) { decimal = d }
        else if let dbl = try? c.decode(Double.self) { decimal = Decimal(dbl) }
        else if let i = try? c.decode(Int.self) { decimal = Decimal(i) }
        else { decimal = 0 }
    }
}
```

- [ ] **Step 4: Write the domain models**

Create `Alsi/Core/Models/Cashflow.swift`:

```swift
import Foundation

struct CashflowLine: Decodable, Identifiable {
    var id: String { "\(kind)-\(label)" }
    let label: String
    let amount: MoneyValue
    let kind: String
}

struct CashflowSummary: Decodable {
    let currency: String
    let incomeMonthly: MoneyValue
    let recurringMonthly: MoneyValue
    let debtEmiMonthly: MoneyValue
    let cardMinMonthly: MoneyValue
    let discretionaryMonthly: MoneyValue
    let leftoverMonthly: MoneyValue
    let breakdown: [CashflowLine]

    enum CodingKeys: String, CodingKey {
        case currency
        case incomeMonthly = "income_monthly"
        case recurringMonthly = "recurring_monthly"
        case debtEmiMonthly = "debt_emi_monthly"
        case cardMinMonthly = "card_min_monthly"
        case discretionaryMonthly = "discretionary_monthly"
        case leftoverMonthly = "leftover_monthly"
        case breakdown
    }
}
```

Create `Alsi/Core/Models/Transaction.swift`:

```swift
import Foundation

struct LineItem: Decodable, Identifiable {
    let id: String
    let name: String
    let amount: MoneyValue
}

struct Transaction: Decodable, Identifiable {
    let id: String
    let merchant: String?
    let amount: MoneyValue
    let currency: String
    let txnDate: String
    let status: String
    let sourceChannel: String?
    let lineItems: [LineItem]

    enum CodingKeys: String, CodingKey {
        case id, merchant, amount, currency
        case txnDate = "txn_date"
        case status
        case sourceChannel = "source_channel"
        case lineItems = "line_items"
    }

    var isDraft: Bool { status == "draft" }

    var displayName: String {
        if let m = merchant, !m.isEmpty { return m }
        if let s = sourceChannel, !s.isEmpty { return s.capitalized }
        return "Transaction"
    }
}
```

Create `Alsi/Core/Models/ReviewQueue.swift`:

```swift
import Foundation

struct ReviewItem: Decodable, Identifiable {
    var id: String { documentId }
    let documentId: String
    let type: String
    let status: String
    let confidence: Double?
    let reasons: [String]
    let batchId: String?

    enum CodingKeys: String, CodingKey {
        case documentId = "document_id"
        case type, status, confidence, reasons
        case batchId = "batch_id"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        documentId = try c.decode(String.self, forKey: .documentId)
        type = try c.decode(String.self, forKey: .type)
        status = try c.decode(String.self, forKey: .status)
        confidence = try c.decodeIfPresent(Double.self, forKey: .confidence)
        reasons = (try? c.decode([String].self, forKey: .reasons)) ?? []
        batchId = try c.decodeIfPresent(String.self, forKey: .batchId)
    }
}

struct ReviewGroup: Decodable, Identifiable {
    var id: String { memberDocumentIds.joined(separator: ":") }
    let memberDocumentIds: [String]
    let suggested: ReviewItem
    let members: [ReviewItem]

    enum CodingKeys: String, CodingKey {
        case memberDocumentIds = "member_document_ids"
        case suggested, members
    }
}

struct ReviewQueue: Decodable {
    static let empty = ReviewQueue(groups: [], items: [])
    let groups: [ReviewGroup]
    let items: [ReviewItem]

    var pendingCount: Int {
        groups.reduce(0) { $0 + max(1, $1.memberDocumentIds.count) } + items.count
    }
}
```

Create `Alsi/Core/Models/RecurringSeries.swift`:

```swift
import Foundation

struct RecurringSeries: Decodable, Identifiable {
    let id: String
    let name: String
    let amount: MoneyValue?
    let currency: String
    let cadence: String
    let type: String
    let status: String
    let nextDueDate: String?
    let merchantName: String?
    let categoryName: String?

    enum CodingKeys: String, CodingKey {
        case id, name, amount, currency, cadence, type, status
        case nextDueDate = "next_due_date"
        case merchantName = "merchant_name"
        case categoryName = "category_name"
    }
}
```

Create `Alsi/Core/Models/Budget.swift`:

```swift
import Foundation

struct Budget: Decodable, Identifiable {
    let id: String
    let amount: MoneyValue
    let currency: String
    let spent: MoneyValue
    let remaining: MoneyValue
    let progressPct: MoneyValue
    let overspent: Bool

    enum CodingKeys: String, CodingKey {
        case id, amount, currency, spent, remaining
        case progressPct = "progress_pct"
        case overspent
    }
}
```

Create `Alsi/Core/Models/NetWorth.swift`:

```swift
import Foundation

struct NetWorth: Decodable {
    let currency: String
    let assets: MoneyValue
    let liabilities: MoneyValue
    let netWorth: MoneyValue

    enum CodingKeys: String, CodingKey {
        case currency, assets, liabilities
        case netWorth = "net_worth"
    }
}
```

Create `Alsi/Core/Models/FinanceSnapshot.swift`:

```swift
import Foundation

struct FinanceSnapshot {
    static let empty = FinanceSnapshot(
        cashflow: nil, transactions: [], reviewQueue: .empty,
        recurringSeries: [], budgets: [], netWorth: nil
    )

    let cashflow: CashflowSummary?
    let transactions: [Transaction]
    let reviewQueue: ReviewQueue
    let recurringSeries: [RecurringSeries]
    let budgets: [Budget]
    let netWorth: NetWorth?

    var currency: String {
        cashflow?.currency
            ?? transactions.first?.currency
            ?? recurringSeries.first?.currency
            ?? budgets.first?.currency
            ?? netWorth?.currency
            ?? "USD"
    }

    var draftTransactionCount: Int { transactions.filter(\.isDraft).count }

    var pendingReviewCount: Int { reviewQueue.pendingCount + draftTransactionCount }

    var hasLiveData: Bool {
        cashflow != nil || !transactions.isEmpty || reviewQueue.pendingCount > 0
            || !recurringSeries.isEmpty || !budgets.isEmpty || netWorth != nil
    }
}
```

- [ ] **Step 5: Write the formatter**

Create `Alsi/Core/Formatting/FinanceFormatter.swift`:

```swift
import Foundation

enum FinanceFormatter {
    static func currency(_ value: Decimal?, currency: String = "USD", signed: Bool = false) -> String {
        guard let value else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = abs(value) >= 100 ? 0 : 2
        f.minimumFractionDigits = 0
        if signed, value > 0 { f.positivePrefix = "+\(f.positivePrefix ?? "")" }
        return f.string(from: NSDecimalNumber(decimal: value)) ?? "\(value)"
    }

    static func percent(_ value: Decimal?) -> String {
        guard let value else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .percent
        f.maximumFractionDigits = 0
        return f.string(from: NSDecimalNumber(decimal: value / 100)) ?? "\(value)%"
    }

    static func shortDate(_ raw: String) -> String {
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: raw) else { return raw }
        let out = DateFormatter()
        out.dateFormat = "MMM d"
        return out.string(from: date)
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild test -scheme Alsi -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | tail -20
```

Expected: `TEST SUCCEEDED` — all four tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -q -m "feat: add UI-free core finance models and formatter with decoding tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: API client + error type (with URL/status tests)

**Files:**
- Create: `Alsi/Core/Networking/APIError.swift`, `Alsi/Core/Networking/APIClient.swift`
- Test: `AlsiTests/APIClientTests.swift`

**Interfaces:**
- Consumes: models (Task 4).
- Produces:
  - `enum FinanceAPIError: LocalizedError { case invalidBaseURL, unauthorized, badStatus(Int), emptyResponse; var errorDescription }`
  - `struct APIClient { let baseURL: URL; let session: URLSession; init(baseURL:session:); func send<Body:Encodable,Response:Decodable>(_ path:String, method:String, query:[String:String], body:Body?, accessToken:String?) async throws -> Response; func get<Response:Decodable>(_ path:String, query:[String:String], accessToken:String) async throws -> Response }`
  - `static func APIClient.makeURL(base:URL, path:String, query:[String:String]) throws -> URL` (exposed for tests).

- [ ] **Step 1: Write the failing tests**

Create `AlsiTests/APIClientTests.swift`:

```swift
import Testing
import Foundation
@testable import Alsi

final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var body = Data("{}".utf8)
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let resp = HTTPURLResponse(url: request.url!, statusCode: Self.status,
                                   httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite struct APIClientTests {
    private func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: config)
    }

    @Test func buildsURLWithPathAndQuery() throws {
        let url = try APIClient.makeURL(
            base: URL(string: "http://localhost:8000")!,
            path: "/cashflow/summary/",
            query: ["months": "6"]
        )
        #expect(url.absoluteString == "http://localhost:8000/cashflow/summary?months=6")
    }

    @Test func unauthorizedMapsToError() async {
        StubProtocol.status = 401
        StubProtocol.body = Data("{}".utf8)
        let client = APIClient(baseURL: URL(string: "http://localhost:8000")!, session: makeSession())
        await #expect(throws: FinanceAPIError.unauthorized) {
            let _: NetWorth = try await client.get("analytics/net-worth", accessToken: "x")
        }
    }

    @Test func decodesSuccessBody() async throws {
        StubProtocol.status = 200
        StubProtocol.body = Data("""
        {"currency":"USD","assets":"10","liabilities":"4","net_worth":"6"}
        """.utf8)
        let client = APIClient(baseURL: URL(string: "http://localhost:8000")!, session: makeSession())
        let nw: NetWorth = try await client.get("analytics/net-worth", accessToken: "x")
        #expect(nw.netWorth.decimal == 6)
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild test -scheme Alsi -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | tail -20
```

Expected: FAIL — `APIClient` / `FinanceAPIError` not found.

- [ ] **Step 3: Write the error type**

Create `Alsi/Core/Networking/APIError.swift`:

```swift
import Foundation

enum FinanceAPIError: LocalizedError, Equatable {
    case invalidBaseURL
    case unauthorized
    case badStatus(Int)
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL: "Invalid API URL"
        case .unauthorized: "Session required"
        case .badStatus(let s): "Backend returned \(s)"
        case .emptyResponse: "Backend returned an empty response"
        }
    }
}
```

- [ ] **Step 4: Write the client**

Create `Alsi/Core/Networking/APIClient.swift`:

```swift
import Foundation

private struct EmptyBody: Encodable {}

struct APIClient {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    static func makeURL(base: URL, path: String, query: [String: String]) throws -> URL {
        guard var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            throw FinanceAPIError.invalidBaseURL
        }
        let basePath = comps.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let endpoint = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        comps.path = "/" + [basePath, endpoint].filter { !$0.isEmpty }.joined(separator: "/")
        if !query.isEmpty {
            comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = comps.url else { throw FinanceAPIError.invalidBaseURL }
        return url
    }

    func get<Response: Decodable>(
        _ path: String, query: [String: String] = [:], accessToken: String
    ) async throws -> Response {
        try await send(path, method: "GET", query: query, body: Optional<EmptyBody>.none, accessToken: accessToken)
    }

    func send<Body: Encodable, Response: Decodable>(
        _ path: String, method: String, query: [String: String] = [:],
        body: Body?, accessToken: String?
    ) async throws -> Response {
        let url = try Self.makeURL(base: baseURL, path: path, query: query)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accessToken, !accessToken.isEmpty {
            req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw FinanceAPIError.emptyResponse }
        if http.statusCode == 401 { throw FinanceAPIError.unauthorized }
        guard 200..<300 ~= http.statusCode else { throw FinanceAPIError.badStatus(http.statusCode) }
        guard !data.isEmpty else { throw FinanceAPIError.emptyResponse }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
```

- [ ] **Step 5: Run to verify pass**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild test -scheme Alsi -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | tail -20
```

Expected: `TEST SUCCEEDED`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -q -m "feat: add generic API client with URL and status-mapping tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: FinanceService, Keychain, and the observable store

**Files:**
- Create: `Alsi/Core/Networking/FinanceService.swift`, `Alsi/Core/Auth/KeychainStore.swift`, `Alsi/Core/State/FinanceStore.swift`
- Test: `AlsiTests/SnapshotTests.swift`

**Interfaces:**
- Consumes: `APIClient`, models.
- Produces:
  - `struct FinanceService { let client: APIClient; func login(email:password:) async throws -> String; func fetchSnapshot(accessToken:) async throws -> FinanceSnapshot }`
  - `struct KeychainStore { let service:String; func read(_ key:String)->String?; func write(_ value:String, key:String); func delete(_ key:String) }`
  - `enum FinanceDataPhase: Equatable { case idle, loading, loaded, signedOut, failed(String) }`
  - `@Observable @MainActor final class FinanceStore { var phase; var snapshot; var authError; var apiBaseURL:String; var isSignedIn:Bool; func refreshIfNeeded() async; func refresh() async; func signIn(email:password:baseURL:) async; func signOut() }`

- [ ] **Step 1: Write the failing snapshot test**

Create `AlsiTests/SnapshotTests.swift`:

```swift
import Testing
import Foundation
@testable import Alsi

@Suite struct SnapshotTests {
    @Test func fetchSnapshotComposesAllEndpoints() async throws {
        StubProtocol.status = 200
        StubProtocol.body = Data("""
        {"currency":"USD","assets":"10","liabilities":"4","net_worth":"6"}
        """.utf8)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SnapshotStubProtocol.self]
        let session = URLSession(configuration: config)
        let service = FinanceService(client: APIClient(
            baseURL: URL(string: "http://localhost:8000")!, session: session))
        let snap = try await service.fetchSnapshot(accessToken: "x")
        #expect(snap.netWorth?.netWorth.decimal == 6)
        #expect(snap.transactions.isEmpty)
        #expect(snap.currency == "USD")
    }
}

final class SnapshotStubProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url?.path ?? ""
        let body: String
        switch path {
        case let p where p.hasSuffix("net-worth"):
            body = "{\"currency\":\"USD\",\"assets\":\"10\",\"liabilities\":\"4\",\"net_worth\":\"6\"}"
        case let p where p.hasSuffix("cashflow/summary"):
            body = "{\"currency\":\"USD\",\"income_monthly\":\"0\",\"recurring_monthly\":\"0\",\"debt_emi_monthly\":\"0\",\"card_min_monthly\":\"0\",\"discretionary_monthly\":\"0\",\"leftover_monthly\":\"0\",\"breakdown\":[]}"
        case let p where p.hasSuffix("review-queue"):
            body = "{\"groups\":[],\"items\":[]}"
        default:
            body = "[]"
        }
        let resp = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild test -scheme Alsi -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | tail -20
```

Expected: FAIL — `FinanceService` not found.

- [ ] **Step 3: Write the service (parallel fetch)**

Create `Alsi/Core/Networking/FinanceService.swift`:

```swift
import Foundation

struct FinanceService {
    let client: APIClient

    private struct LoginRequest: Encodable { let email: String; let password: String }
    private struct AccessTokenResponse: Decodable {
        let accessToken: String
        enum CodingKeys: String, CodingKey { case accessToken = "access_token" }
    }

    func login(email: String, password: String) async throws -> String {
        let resp: AccessTokenResponse = try await client.send(
            "auth/login", method: "POST",
            body: LoginRequest(email: email, password: password), accessToken: nil)
        return resp.accessToken
    }

    func fetchSnapshot(accessToken token: String) async throws -> FinanceSnapshot {
        async let cashflow: CashflowSummary = client.get("cashflow/summary", query: ["months": "6"], accessToken: token)
        async let transactions: [Transaction] = client.get("transactions", accessToken: token)
        async let reviewQueue: ReviewQueue = client.get("review-queue", accessToken: token)
        async let recurring: [RecurringSeries] = client.get("recurring-series", query: ["status": "active"], accessToken: token)
        async let budgets: [Budget] = client.get("budgets", accessToken: token)
        async let netWorth: NetWorth = client.get("analytics/net-worth", accessToken: token)

        return try await FinanceSnapshot(
            cashflow: cashflow,
            transactions: transactions,
            reviewQueue: reviewQueue,
            recurringSeries: recurring,
            budgets: budgets,
            netWorth: netWorth
        )
    }
}
```

- [ ] **Step 4: Write the Keychain store**

Create `Alsi/Core/Auth/KeychainStore.swift`:

```swift
import Foundation
import Security

struct KeychainStore {
    let service: String

    func read(_ key: String) -> String? {
        var query: [String: Any] = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func write(_ value: String, key: String) {
        delete(key)
        var query = baseQuery(key)
        query[kSecValueData as String] = Data(value.utf8)
        SecItemAdd(query as CFDictionary, nil)
    }

    func delete(_ key: String) {
        SecItemDelete(baseQuery(key) as CFDictionary)
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }
}
```

- [ ] **Step 5: Write the observable store**

Create `Alsi/Core/State/FinanceStore.swift`:

```swift
import Foundation
import Observation

enum FinanceDataPhase: Equatable {
    case idle, loading, loaded, signedOut
    case failed(String)
    var isRefreshing: Bool { if case .loading = self { true } else { false } }
}

@Observable
@MainActor
final class FinanceStore {
    private(set) var phase: FinanceDataPhase = .idle
    private(set) var snapshot: FinanceSnapshot = .empty
    var authError: String?

    private let keychain = KeychainStore(service: "com.alsi.app")
    private let defaults = UserDefaults.standard
    private let tokenKey = "alsi.accessToken"
    private let baseURLKey = "alsi.apiBaseURL"

    var apiBaseURL: String {
        get { defaults.string(forKey: baseURLKey) ?? "http://localhost:8000" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: baseURLKey) }
    }

    private var accessToken: String {
        get { keychain.read(tokenKey) ?? "" }
        set {
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { keychain.delete(tokenKey) }
            else { keychain.write(trimmed, key: tokenKey) }
        }
    }

    var isSignedIn: Bool { !accessToken.isEmpty }

    private func service() -> FinanceService {
        let url = URL(string: apiBaseURL) ?? URL(string: "http://localhost:8000")!
        return FinanceService(client: APIClient(baseURL: url))
    }

    func refreshIfNeeded() async {
        if case .idle = phase { await refresh() }
    }

    func refresh() async {
        authError = nil
        guard isSignedIn else { snapshot = .empty; phase = .signedOut; return }
        phase = .loading
        do {
            snapshot = try await service().fetchSnapshot(accessToken: accessToken)
            phase = .loaded
        } catch FinanceAPIError.unauthorized {
            snapshot = .empty; accessToken = ""; phase = .signedOut
        } catch {
            snapshot = .empty; phase = .failed(error.localizedDescription)
        }
    }

    func signIn(email: String, password: String, baseURL: String) async {
        authError = nil
        apiBaseURL = baseURL
        phase = .loading
        do {
            accessToken = try await service().login(email: email, password: password)
            await refresh()
        } catch {
            accessToken = ""; snapshot = .empty
            authError = error.localizedDescription; phase = .signedOut
        }
    }

    func signOut() {
        accessToken = ""; snapshot = .empty; phase = .signedOut
    }
}
```

- [ ] **Step 6: Run to verify pass**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild test -scheme Alsi -destination 'platform=iOS Simulator,name=iPhone 17 Pro' 2>&1 | tail -20
```

Expected: `TEST SUCCEEDED`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -q -m "feat: add finance service (parallel snapshot), keychain, and observable store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Shared state cards + Sign-in sheet

**Files:**
- Create: `Alsi/Features/Shared/StateCards.swift`, `Alsi/Features/Auth/SignInSheet.swift`

**Interfaces:**
- Consumes: `Caesar`, `FinanceStore`, `heroGlass()`.
- Produces: `struct LoadingCard: View`, `struct ErrorCard: View { let message:String; let retry:()->Void }`, `struct EmptyCard: View { let title:String; let message:String }`, `struct SignInSheet: View { let store: FinanceStore }`.

- [ ] **Step 1: Write the state cards**

Create `Alsi/Features/Shared/StateCards.swift`:

```swift
import SwiftUI

struct LoadingCard: View {
    var body: some View {
        HStack(spacing: Space.md) {
            ProgressView().tint(Caesar.bone)
            Text("Loading…").foregroundStyle(Caesar.boneDim)
        }
        .frame(maxWidth: .infinity)
        .heroGlass()
    }
}

struct ErrorCard: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: Space.md) {
            Text(message).foregroundStyle(Caesar.bone).multilineTextAlignment(.center)
            Button("Retry", action: retry).buttonStyle(.glassProminent).tint(Caesar.wineLit)
        }
        .frame(maxWidth: .infinity)
        .heroGlass()
    }
}

struct EmptyCard: View {
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: Space.xs) {
            Text(title).font(.headline).foregroundStyle(Caesar.bone)
            Text(message).font(.subheadline).foregroundStyle(Caesar.boneDim)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .heroGlass()
    }
}
```

- [ ] **Step 2: Write the sign-in sheet**

Create `Alsi/Features/Auth/SignInSheet.swift`:

```swift
import SwiftUI

struct SignInSheet: View {
    let store: FinanceStore
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var password = ""
    @State private var baseURL = ""
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                }
                Section("Backend") {
                    TextField("API base URL", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                if let error = store.authError {
                    Section { Text(error).foregroundStyle(Caesar.wineGlow) }
                }
            }
            .navigationTitle("Sign in")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sign in") { submit() }
                        .disabled(email.isEmpty || password.isEmpty || submitting)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .onAppear { if baseURL.isEmpty { baseURL = store.apiBaseURL } }
    }

    private func submit() {
        submitting = true
        Task {
            await store.signIn(email: email, password: password, baseURL: baseURL)
            submitting = false
            if store.isSignedIn { dismiss() }
        }
    }
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild -scheme Alsi -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5
git add -A && git commit -q -m "feat: add shared state cards and sign-in sheet

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: RootView — native TabView with Liquid Glass tab bar

**Files:**
- Modify (replace): `Alsi/App/RootView.swift`
- Modify (replace): `Alsi/App/AlsiApp.swift`

**Interfaces:**
- Consumes: `FinanceStore`, `CaesarBackground`, `DashboardView`, `SpendView`, `ComingSoonView`, `SignInSheet`.
- Produces: the app's root scene; injects `FinanceStore` into the environment.

- [ ] **Step 1: Update the app entry to own the store**

Replace `Alsi/App/AlsiApp.swift`:

```swift
import SwiftUI

@main
struct AlsiApp: App {
    @State private var store = FinanceStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .preferredColorScheme(.dark)
                .tint(Caesar.wineGlow)
        }
    }
}
```

- [ ] **Step 2: Replace RootView with a native TabView**

Replace `Alsi/App/RootView.swift`:

```swift
import SwiftUI

struct RootView: View {
    @Environment(FinanceStore.self) private var store
    @State private var showingSignIn = false

    var body: some View {
        TabView {
            Tab("Home", systemImage: "square.grid.2x2") {
                dashboardTab
            }
            Tab("Spend", systemImage: "list.bullet.rectangle") {
                spendTab
            }
            Tab("Insights", systemImage: "chart.pie") {
                placeholderTab(title: "Insights",
                               message: "Trends, categories, and recurring analysis are coming next.")
            }
            Tab("Plan", systemImage: "target") {
                placeholderTab(title: "Plan",
                               message: "Budgets, debt, and payoff planning are coming next.")
            }
        }
        .background(CaesarBackground())
        .sheet(isPresented: $showingSignIn) { SignInSheet(store: store) }
        .task { await store.refreshIfNeeded() }
    }

    private var dashboardTab: some View {
        NavigationStack {
            DashboardView(onSignIn: { showingSignIn = true })
                .navigationTitle("Home")
                .toolbar { signInToolbar }
        }
    }

    private var spendTab: some View {
        NavigationStack {
            SpendView(onSignIn: { showingSignIn = true })
                .navigationTitle("Spend")
                .toolbar { signInToolbar }
        }
    }

    private func placeholderTab(title: String, message: String) -> some View {
        NavigationStack {
            ComingSoonView(title: title, message: message)
                .navigationTitle(title)
        }
    }

    @ToolbarContentBuilder
    private var signInToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if store.isSignedIn {
                Button("Sign out") { store.signOut() }
            } else {
                Button("Sign in") { showingSignIn = true }
            }
        }
    }
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild -scheme Alsi -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5
git add -A && git commit -q -m "feat: native TabView root with Liquid Glass tab bar and CAESAR backdrop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: `DashboardView`, `SpendView`, `ComingSoonView` don't exist until Tasks 9–11; the build will fail until those land. If executing strictly task-by-task, create empty stubs first:
> `struct DashboardView: View { let onSignIn: () -> Void; var body: some View { EmptyView() } }` etc., then flesh them out in their tasks. Prefer building Tasks 9–11 immediately after this one and running the build once at the end of Task 11.

---

## Task 9: Dashboard screen

**Files:**
- Create: `Alsi/Features/Dashboard/DashboardMetric.swift`, `Alsi/Features/Dashboard/DashboardView.swift`

**Interfaces:**
- Consumes: `FinanceStore`, `FinanceSnapshot`, `FinanceFormatter`, `Caesar`, `Metric`, `heroGlass()`, `LoadingCard/ErrorCard/EmptyCard`.
- Produces: `struct DashboardView: View { let onSignIn: () -> Void }`; `struct DashboardMetric: Identifiable` presentation model built from a `FinanceSnapshot`.

- [ ] **Step 1: Write the presentation model**

Create `Alsi/Features/Dashboard/DashboardMetric.swift`:

```swift
import Foundation

struct DashboardMetric: Identifiable {
    let id = UUID()
    let title: String
    let value: String
    let footnote: String

    static func from(_ snap: FinanceSnapshot) -> [DashboardMetric] {
        [
            DashboardMetric(
                title: "Safe to spend",
                value: FinanceFormatter.currency(snap.cashflow?.leftoverMonthly.decimal, currency: snap.currency),
                footnote: "Income minus recurring, EMIs, card minimums, and discretionary spend"),
            DashboardMetric(
                title: "Needs review",
                value: snap.pendingReviewCount == 0 && !snap.hasLiveData ? "—" : "\(snap.pendingReviewCount)",
                footnote: "Documents and draft transactions pending confirmation"),
            DashboardMetric(
                title: "Net worth",
                value: FinanceFormatter.currency(snap.netWorth?.netWorth.decimal, currency: snap.currency),
                footnote: "Latest backend account balance rollup")
        ]
    }
}
```

- [ ] **Step 2: Write the Dashboard view**

Create `Alsi/Features/Dashboard/DashboardView.swift`:

```swift
import SwiftUI

struct DashboardView: View {
    @Environment(FinanceStore.self) private var store
    let onSignIn: () -> Void
    @Namespace private var glassNamespace

    var body: some View {
        ScrollView {
            VStack(spacing: Space.lg) {
                switch store.phase {
                case .idle, .loading:
                    LoadingCard()
                case .signedOut:
                    EmptyCard(title: "Sign in to Alsi", message: "Connect to your backend to see cash flow and net worth.")
                    Button("Sign in", action: onSignIn).buttonStyle(.glassProminent).tint(Caesar.wineLit)
                case .failed(let message):
                    ErrorCard(message: message) { Task { await store.refresh() } }
                case .loaded:
                    content
                }
            }
            .padding(Space.md)
        }
        .scrollEdgeEffectStyle(.automatic, for: .top)
        .refreshable { await store.refresh() }
    }

    private var content: some View {
        let snap = store.snapshot
        return GlassEffectContainer(spacing: Space.lg) {
            VStack(spacing: Space.lg) {
                heroCard(snap)
                    .glassEffectID("hero", in: glassNamespace)

                ForEach(DashboardMetric.from(snap)) { metric in
                    metricRow(metric)
                }
            }
        }
    }

    private func heroCard(_ snap: FinanceSnapshot) -> some View {
        let leftover = snap.cashflow?.leftoverMonthly.decimal
        return VStack(alignment: .leading, spacing: Space.sm) {
            Text("Net worth").font(.caption).foregroundStyle(Caesar.boneDim)
            Text(FinanceFormatter.currency(snap.netWorth?.netWorth.decimal, currency: snap.currency))
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .foregroundStyle(Caesar.bone)
            if let leftover {
                Label(
                    "\(FinanceFormatter.currency(leftover, currency: snap.currency, signed: true)) leftover / month",
                    systemImage: Metric(sign: leftover).symbol
                )
                .font(.subheadline)
                .foregroundStyle(Metric(sign: leftover).color)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .heroGlass()
    }

    private func metricRow(_ metric: DashboardMetric) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(metric.title).font(.subheadline).foregroundStyle(Caesar.boneDim)
            Text(metric.value).font(.title2.weight(.semibold)).foregroundStyle(Caesar.bone)
            Text(metric.footnote).font(.caption).foregroundStyle(Caesar.boneFaint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Space.md)
        .background(Caesar.inkRaised, in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Caesar.wine.opacity(0.35), lineWidth: 1))
    }
}
```

- [ ] **Step 3: Verify (build) + commit**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild -scheme Alsi -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5
git add -A && git commit -q -m "feat: build Dashboard screen with custom-glass hero card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Spend screen

**Files:**
- Create: `Alsi/Features/Spend/SpendView.swift`

**Interfaces:**
- Consumes: `FinanceStore`, `Transaction`, `FinanceFormatter`, `Caesar`, `Metric`, `pillGlass()`, state cards.
- Produces: `struct SpendView: View { let onSignIn: () -> Void }`.

- [ ] **Step 1: Write the Spend view**

Create `Alsi/Features/Spend/SpendView.swift`:

```swift
import SwiftUI

struct SpendView: View {
    @Environment(FinanceStore.self) private var store
    let onSignIn: () -> Void
    @State private var showDraftsOnly = false

    var body: some View {
        ScrollView {
            VStack(spacing: Space.md) {
                switch store.phase {
                case .idle, .loading:
                    LoadingCard()
                case .signedOut:
                    EmptyCard(title: "Sign in to Alsi", message: "Connect to your backend to see transactions.")
                    Button("Sign in", action: onSignIn).buttonStyle(.glassProminent).tint(Caesar.wineLit)
                case .failed(let message):
                    ErrorCard(message: message) { Task { await store.refresh() } }
                case .loaded:
                    content
                }
            }
            .padding(Space.md)
        }
        .scrollEdgeEffectStyle(.automatic, for: .top)
        .refreshable { await store.refresh() }
        .safeAreaBar(edge: .top) { filterBar }
    }

    private var filterBar: some View {
        HStack {
            Button {
                showDraftsOnly.toggle()
            } label: {
                Label(showDraftsOnly ? "Drafts only" : "All transactions",
                      systemImage: showDraftsOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    .foregroundStyle(Caesar.bone)
            }
            .pillGlass()
            Spacer()
        }
        .padding(.horizontal, Space.md)
    }

    private var rows: [Transaction] {
        showDraftsOnly ? store.snapshot.transactions.filter(\.isDraft) : store.snapshot.transactions
    }

    private var content: some View {
        Group {
            if rows.isEmpty {
                EmptyCard(title: "No transactions", message: showDraftsOnly ? "No drafts pending review." : "Nothing here yet.")
            } else {
                VStack(spacing: Space.sm) {
                    ForEach(rows) { txn in transactionRow(txn) }
                }
            }
        }
    }

    private func transactionRow(_ txn: Transaction) -> some View {
        let sign = Metric(sign: txn.amount.decimal)
        return HStack(spacing: Space.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(txn.displayName).font(.body.weight(.medium)).foregroundStyle(Caesar.bone)
                Text(FinanceFormatter.shortDate(txn.txnDate)).font(.caption).foregroundStyle(Caesar.boneFaint)
            }
            Spacer()
            if txn.isDraft {
                Text("DRAFT").font(.caption2.weight(.bold)).foregroundStyle(Caesar.wineGlow)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Caesar.wine.opacity(0.35), in: .capsule)
            }
            Text(FinanceFormatter.currency(txn.amount.decimal, currency: txn.currency, signed: true))
                .font(.body.weight(.semibold).monospacedDigit())
                .foregroundStyle(sign.color)
        }
        .padding(Space.md)
        .background(Caesar.inkRaised, in: .rect(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Caesar.wine.opacity(0.30), lineWidth: 1))
    }
}
```

- [ ] **Step 2: Verify (build) + commit**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild -scheme Alsi -destination 'generic/platform=iOS Simulator' build 2>&1 | tail -5
git add -A && git commit -q -m "feat: build Spend screen with glass filter pill and draft badges

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Coming-soon placeholder + full build

**Files:**
- Create: `Alsi/Features/Placeholder/ComingSoonView.swift`

**Interfaces:**
- Consumes: `Caesar`, `heroGlass()`.
- Produces: `struct ComingSoonView: View { let title: String; let message: String }`.

- [ ] **Step 1: Write the placeholder**

Create `Alsi/Features/Placeholder/ComingSoonView.swift`:

```swift
import SwiftUI

struct ComingSoonView: View {
    let title: String
    let message: String

    var body: some View {
        VStack {
            Spacer()
            VStack(spacing: Space.sm) {
                Image(systemName: "hourglass")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(Caesar.wineGlow)
                Text(title).font(.title2.weight(.semibold)).foregroundStyle(Caesar.bone)
                Text(message).font(.subheadline).foregroundStyle(Caesar.boneDim)
                    .multilineTextAlignment(.center)
            }
            .heroGlass()
            .padding(Space.lg)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
```

- [ ] **Step 2: Full build + test**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcrun simctl list devices available | grep -i iphone | head
xcodebuild -scheme Alsi -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build test 2>&1 | tail -25
```

Expected: `** BUILD SUCCEEDED **` and `** TEST SUCCEEDED **` (all suites pass).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -q -m "feat: add coming-soon placeholder for Insights and Plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Manual run verification

**Files:** none (verification only).

- [ ] **Step 1: Boot a simulator and install**

```bash
cd /Users/kshtj/CourseWork/Study/Projects/CodeName-Missing/Alsi
xcodebuild -scheme Alsi -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build build 2>&1 | tail -5
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null || true
xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/Alsi.app
xcrun simctl launch booted com.alsi.app
```

Expected: app launches; tab bar renders as a floating Liquid Glass bar; backdrop shows the oxblood bloom; Dashboard/Spend show the signed-out empty state with a "Sign in" glass button.

- [ ] **Step 2: Exercise the sign-in path (backend running on `localhost:8000`)**

Verify: tapping "Sign in", entering credentials, and confirming transitions the tab to `.loaded` with the hero glass card populated. If the backend isn't reachable, verify the `.failed` state shows `ErrorCard` with a working Retry button.

- [ ] **Step 3: Report**

Summarize what rendered vs. the spec (glass tab bar, backdrop lensing, hero card, Spend filter pill, draft badges). Note any Liquid Glass API that behaved differently than documented so it can be tuned.

---

## Self-Review Notes

- **Spec coverage:** §3 native glass → Tasks 3, 8, 9, 10 (system TabView/toolbar; custom `.glassEffect` only on hero/pill). CAESAR tokens → Task 2. Backdrop → Task 3. §4 modules/`@Observable`/Keychain/parallel fetch → Tasks 4–6. §5 screens + four states → Tasks 7–11. §6 `.pbxproj` synchronized group + git removal → Task 1. §7 Swift Testing + `xcodebuild` → Tasks 4, 5, 6, 11, 12.
- **Core is UI-free:** models/formatter/service import Foundation only; all `Color`/`View` usage lives in DesignSystem/Features. ✔
- **Type consistency:** `FinanceStore.snapshot: FinanceSnapshot`, `phase: FinanceDataPhase`; `APIClient.get`/`send` signatures match test call sites; `Metric(sign:)`, `heroGlass()`, `pillGlass()`, `LoadingCard/ErrorCard/EmptyCard`, `DashboardMetric.from(_:)` all referenced with the signatures they're defined with. ✔
- **Known environment risk:** all `xcodebuild` steps require a full Xcode + iOS 27 simulator. Task 1 Step 6 gates this and defines the fallback (author-only, user builds). Simulator device name (`iPhone 17 Pro`) must be adjusted to one present in `xcrun simctl list devices available`.
- **Deferred by design:** Insights/Plan features, offline cache, gain/loss green — all per spec §1/§9.
```
