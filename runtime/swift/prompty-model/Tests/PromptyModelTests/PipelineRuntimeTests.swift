import XCTest
@testable import PromptyModel

final class PipelineRuntimeTests: XCTestCase {
  func testOpenAIResponsesEmptyOutputTextFallsBackToMessageContent() throws {
    let response: [String: Any] = [
      "object": "response",
      "output_text": "",
      "output": [
        [
          "type": "message",
          "content": [
            [
              "type": "output_text",
              "text": "Nested text wins.",
            ]
          ],
        ]
      ],
    ]

    let result = processResponse(
      provider: "openai",
      apiType: "responses",
      response: response,
      hasOutputs: false
    )

    XCTAssertEqual(result as? String, "Nested text wins.")
  }
}
