// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AalsiFinanceKit",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(name: "AalsiFinanceKit", targets: ["AalsiFinanceKit"])
    ],
    targets: [
        .target(name: "AalsiFinanceKit"),
        .testTarget(name: "AalsiFinanceKitTests", dependencies: ["AalsiFinanceKit"]),
    ]
)
