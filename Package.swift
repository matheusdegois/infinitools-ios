// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "InfinitoolsCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "InfinitoolsCore", targets: ["InfinitoolsCore"])],
    targets: [
        .target(name: "InfinitoolsCore", path: "Infinitools/Core"),
        .testTarget(name: "InfinitoolsCoreTests", dependencies: ["InfinitoolsCore"], path: "Tests/Core")
    ]
)
