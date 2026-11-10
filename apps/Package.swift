// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "Piton",
    platforms: [
        .macOS("27.0"),
        .iOS("27.0"),
    ],
    products: [
        .library(name: "PitonKit", targets: ["PitonKit"]),
        .library(name: "PitonUI", targets: ["PitonUI"]),
    ],
    targets: [
        // Protocol types, daemon connection, session store. No UI frameworks.
        .target(
            name: "PitonKit",
            path: "packages/PitonKit/Sources"
        ),
        .testTarget(
            name: "PitonKitTests",
            dependencies: ["PitonKit"],
            path: "packages/PitonKit/Tests",
            // Protocol fixtures written by the daemon's tests (`fixtures` in daemon/src/view.rs).
            resources: [.copy("Fixtures")]
        ),
        // SwiftUI views shared by the iOS and macOS apps.
        .target(
            name: "PitonUI",
            dependencies: ["PitonKit"],
            path: "packages/PitonUI/Sources"
        ),
    ],
    swiftLanguageModes: [.v6]
)
