// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "Prompty",
  platforms: [.macOS(.v12), .iOS(.v15)],
  products: [
    .library(name: "Prompty", targets: ["Prompty"]),
    .library(name: "PromptyOpenAI", targets: ["PromptyOpenAI"]),
    .library(name: "PromptyAnthropic", targets: ["PromptyAnthropic"]),
    .library(name: "PromptyFoundry", targets: ["PromptyFoundry"]),
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
      ],
      resources: [.copy("Resources/model_capabilities.json")]
    ),
    .target(
      name: "PromptyOpenAI",
      dependencies: ["Prompty", .product(name: "PromptyModel", package: "prompty-model")]
    ),
    .target(
      name: "PromptyAnthropic",
      dependencies: ["Prompty", .product(name: "PromptyModel", package: "prompty-model")]
    ),
    .target(
      name: "PromptyFoundry",
      dependencies: ["Prompty", .product(name: "PromptyModel", package: "prompty-model")]
    ),
    .testTarget(
      name: "PromptyTests",
      dependencies: [
        "Prompty", "PromptyOpenAI", "PromptyAnthropic", "PromptyFoundry",
        .product(name: "PromptyModel", package: "prompty-model"),
        .product(name: "Yams", package: "Yams"),
      ]
    ),
  ]
)
