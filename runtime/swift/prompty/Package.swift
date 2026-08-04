// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "Prompty",
  platforms: [.macOS(.v12), .iOS(.v15)],
  products: [
    .library(name: "Prompty", targets: ["Prompty"])
  ],
  dependencies: [
    .package(path: "../prompty-model"),
    .package(url: "https://github.com/jpsim/Yams.git", from: "5.1.3"),
  ],
  targets: [
    .target(
      name: "Prompty",
      dependencies: [
        .product(name: "PromptyModel", package: "prompty-model"),
        .product(name: "Yams", package: "Yams"),
      ]
    ),
    .testTarget(
      name: "PromptyTests",
      dependencies: [
        "Prompty",
        .product(name: "PromptyModel", package: "prompty-model"),
        .product(name: "Yams", package: "Yams"),
      ]
    ),
  ]
)
