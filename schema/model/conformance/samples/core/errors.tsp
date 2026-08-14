// Named sample constants for core/errors.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const InvokerErrorMessageSample = #{
  message: "No renderer registered for key: jinja2",
};

const InvokerErrorComponentSample = #{ component: "renderer" };

const InvokerErrorKeySample = #{ key: "jinja2" };

const ValidationErrorMessageSample = #{
  message: "Missing required input: firstName",
};

const ValidationErrorPropertySample = #{ property: "firstName" };

const ValidationErrorConstraintSample = #{ constraint: "required" };

const FileNotFoundErrorMessageSample = #{
  message: "Prompty file not found: ./chat.prompty",
};

const FileNotFoundErrorPathSample = #{ path: "./chat.prompty" };
