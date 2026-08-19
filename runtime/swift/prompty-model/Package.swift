// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "PromptyModel",
  platforms: [.macOS(.v12), .iOS(.v15)],
  products: [.library(name: "PromptyModel", targets: ["PromptyModel"])],
  dependencies: [
    .package(url: "https://github.com/jpsim/Yams.git", from: "5.1.3")
  ],
  targets: [
    .target(name: "PromptyModel", dependencies: [.product(name: "Yams", package: "Yams")], path: "Sources/PromptyModel"),
    .testTarget(name: "PromptyModelTests", dependencies: ["PromptyModel"], path: "Tests/PromptyModelTests")
  ]
)
