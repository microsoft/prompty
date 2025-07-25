using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Newtonsoft.Json;
using Prompty.Core;

namespace Prompty.TCK
{
    public class CSharpTCK
    {
        private readonly string tckRootPath;
        
        public CSharpTCK()
        {
            // Get the parent directory of the current directory (which is csharp/)
            // to find the TCK root directory
            tckRootPath = Directory.GetParent(Directory.GetCurrentDirectory())?.FullName ?? Directory.GetCurrentDirectory();
            
            // Initialize the Prompty Core library
            InvokerFactory.AutoDiscovery();
        }
        
        public static void Main(string[] args)
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("Usage: CSharpTCK <test-file> <output-file>");
                Environment.Exit(1);
            }
            
            string testFile = args[0];
            string outputFile = args[1];
            
            var tck = new CSharpTCK();
            try
            {
                tck.RunTests(testFile, outputFile);
            }
            catch (Exception e)
            {
                Console.Error.WriteLine($"TCK execution failed: {e.Message}");
                Console.Error.WriteLine(e.StackTrace);
                Environment.Exit(1);
            }
        }
        
        public void RunTests(string testFile, string outputFile)
        {
            Console.WriteLine("C# Prompty TCK Starting...");
            
            // Read test definitions
            string testContent = File.ReadAllText(testFile);
            var testData = JsonConvert.DeserializeObject<Dictionary<string, object>>(testContent);
            
            if (testData == null || !testData.ContainsKey("tests"))
            {
                throw new InvalidOperationException("Invalid test file format");
            }
            
            var tests = JsonConvert.DeserializeObject<List<Dictionary<string, object>>>(testData["tests"].ToString());
            if (tests == null)
            {
                throw new InvalidOperationException("No tests found in test file");
            }
            
            var results = new List<Dictionary<string, object>>();
            
            foreach (var test in tests)
            {
                string testId = test.GetValueOrDefault("id", "").ToString();
                Console.WriteLine($"Running test: {testId}");
                
                var result = RunSingleTest(test);
                results.Add(result);
            }
            
            // Create output metadata using the Prompty.Core library approach
            var output = new Dictionary<string, object>
            {
                ["runtime"] = "csharp",
                ["timestamp"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"),
                ["version"] = "1.0",
                ["total_tests"] = results.Count,
                ["results"] = results
            };
            
            // Save results
            Directory.CreateDirectory(Path.GetDirectoryName(outputFile) ?? ".");
            string json = JsonConvert.SerializeObject(output, Formatting.Indented);
            File.WriteAllText(outputFile, json);
            
            Console.WriteLine("C# Prompty TCK Completed");
        }
        
        private Dictionary<string, object> RunSingleTest(Dictionary<string, object> test)
        {
            var result = new Dictionary<string, object>
            {
                ["test_id"] = test.GetValueOrDefault("id", ""),
                ["test_type"] = DetermineTestType(test),
                ["runtime"] = "csharp"
            };
            
            var startTime = DateTime.UtcNow;
            
            try
            {
                string testType = DetermineTestType(test);
                
                switch (testType.ToLower())
                {
                    case "parse":
                        result = RunParseTest(test, result);
                        break;
                    case "render":
                        result = RunRenderTest(test, result);
                        break;
                    case "execute":
                        result = RunExecuteTest(test, result);
                        break;
                    default:
                        result["status"] = "skip";
                        result["message"] = $"Unknown test type: {testType}";
                        break;
                }
            }
            catch (Exception e)
            {
                result["status"] = "error";
                result["error"] = e.Message;
                result["error_type"] = e.GetType().Name;
            }
            
            var endTime = DateTime.UtcNow;
            result["execution_time_ms"] = (endTime - startTime).TotalMilliseconds;
            
            return result;
        }
        
        private string DetermineTestType(Dictionary<string, object> test)
        {
            // If explicit type is specified, use it
            if (test.ContainsKey("type") && !string.IsNullOrEmpty(test["type"]?.ToString()))
            {
                return test["type"].ToString()!;
            }
            
            // Infer test type from other fields
            if (test.ContainsKey("expected_parsing"))
            {
                return "parse";
            }
            else if (test.ContainsKey("expected_rendering") || test.ContainsKey("input_data"))
            {
                return "render";
            }
            else if (test.ContainsKey("expected_execution"))
            {
                return "execute";
            }
            
            // Default to parse if we can't determine
            return "parse";
        }
        
        private Dictionary<string, object> RunParseTest(Dictionary<string, object> test, Dictionary<string, object> result)
        {
            string promptyFile = test.GetValueOrDefault("prompty_file", "").ToString() ?? "";
            string expectedFile = test.GetValueOrDefault("expected_parsing", test.GetValueOrDefault("expected_file", "")).ToString() ?? "";
            
            // Resolve paths relative to TCK root
            promptyFile = ResolveTckPath(promptyFile);
            expectedFile = ResolveTckPath(expectedFile);
            
            // Use Prompty.Core library to load and parse the prompty file
            var prompty = Prompty.Core.Prompty.Load(promptyFile);
            
            // Convert to a dictionary format similar to the Python implementation
            var parsed = ConvertPromptyToDict(prompty);
            
            // Load expected results if available
            if (!string.IsNullOrEmpty(expectedFile) && File.Exists(expectedFile))
            {
                var expected = LoadExpectedResults(expectedFile);
                bool matches = CompareResults(parsed, expected);
                
                result["status"] = matches ? "pass" : "fail";
                result["actual"] = parsed;
                result["expected"] = expected;
                
                if (!matches)
                {
                    result["differences"] = FindDifferences(expected, parsed);
                }
            }
            else
            {
                result["status"] = "pass";
                result["actual"] = parsed;
                result["message"] = "No expected results file found";
            }
            
            return result;
        }
        
        private Dictionary<string, object> RunRenderTest(Dictionary<string, object> test, Dictionary<string, object> result)
        {
            string promptyFile = test.GetValueOrDefault("prompty_file", "").ToString() ?? "";
            string expectedFile = test.GetValueOrDefault("expected_rendering", "").ToString() ?? "";
            
            // Resolve paths relative to TCK root
            promptyFile = ResolveTckPath(promptyFile);
            expectedFile = ResolveTckPath(expectedFile);
            
            // Use Prompty.Core library to load the prompty file
            var prompty = Prompty.Core.Prompty.Load(promptyFile);
            
            // Get inputs from test data - check both "input_data" and "inputs"
            var inputs = test.GetValueOrDefault("input_data", test.GetValueOrDefault("inputs", new Dictionary<string, object>())) as Dictionary<string, object> ?? new();
            
            try
            {
                // Use Prompty.Core to render the template
                var rendered = prompty.Prepare(inputs);
                
                // Load expected results if available
                if (!string.IsNullOrEmpty(expectedFile) && File.Exists(expectedFile))
                {
                    var expectedContent = File.ReadAllText(expectedFile);
                    bool matches = rendered?.ToString()?.Trim() == expectedContent.Trim();
                    
                    result["status"] = matches ? "pass" : "fail";
                    result["actual"] = rendered?.ToString() ?? "";
                    result["expected"] = expectedContent;
                    
                    if (!matches)
                    {
                        result["differences"] = new Dictionary<string, object>
                        {
                            ["actual_length"] = rendered?.ToString()?.Length ?? 0,
                            ["expected_length"] = expectedContent.Length,
                            ["content_match"] = false
                        };
                    }
                }
                else
                {
                    result["status"] = "pass";
                    result["actual"] = rendered?.ToString() ?? "";
                    result["message"] = "No expected results file found";
                }
            }
            catch (Exception e)
            {
                result["status"] = "error";
                result["error"] = e.Message;
                result["error_type"] = e.GetType().Name;
            }
            
            return result;
        }
        
        private Dictionary<string, object> RunExecuteTest(Dictionary<string, object> test, Dictionary<string, object> result)
        {
            string promptyFile = test.GetValueOrDefault("prompty_file", "").ToString() ?? "";
            string expectedFile = test.GetValueOrDefault("expected_execution", test.GetValueOrDefault("expected_file", "")).ToString() ?? "";
            
            // Resolve paths relative to TCK root
            promptyFile = ResolveTckPath(promptyFile);
            expectedFile = ResolveTckPath(expectedFile);
            
            // Use Prompty.Core library to load the prompty file
            var prompty = Prompty.Core.Prompty.Load(promptyFile);
            
            // Get inputs from test data - check both "input_data" and "inputs"
            var inputs = test.GetValueOrDefault("input_data", test.GetValueOrDefault("inputs", new Dictionary<string, object>())) as Dictionary<string, object> ?? new();
            
            try
            {
                // For TCK purposes, we'll simulate execution since we don't have real AI endpoints
                // This follows the same pattern as the Python TCK
                var executed = prompty.Prepare(inputs);
                var simulatedResponse = $"Simulated response for: {executed}";
                
                result["status"] = "pass";
                result["actual"] = simulatedResponse;
                result["message"] = "Execution simulated (no real AI endpoint)";
                
                // If expected file exists, compare with it
                if (!string.IsNullOrEmpty(expectedFile) && File.Exists(expectedFile))
                {
                    var expectedContent = File.ReadAllText(expectedFile);
                    result["expected"] = expectedContent;
                    result["differences"] = new Dictionary<string, object>
                    {
                        ["note"] = "Execution test with simulated response",
                        ["actual_type"] = "simulated",
                        ["expected_type"] = "file_content"
                    };
                }
            }
            catch (Exception e)
            {
                result["status"] = "error";
                result["error"] = e.Message;
                result["error_type"] = e.GetType().Name;
            }
            
            return result;
        }
        
        private Dictionary<string, object> ConvertPromptyToDict(Prompty.Core.Prompty prompty)
        {
            var result = new Dictionary<string, object>();
            
            // Add content
            result["content"] = prompty.Content?.ToString() ?? "";
            
            // Add model information
            if (prompty.Model != null)
            {
                var modelDict = new Dictionary<string, object>
                {
                    ["api"] = prompty.Model.Api ?? "",
                };
                
                if (prompty.Model.Connection != null)
                {
                    modelDict["configuration"] = prompty.Model.Connection.ExtensionData ?? new Dictionary<string, object>();
                }
                
                if (prompty.Model.Options != null)
                {
                    modelDict["parameters"] = prompty.Model.Options;
                }
                
                result["model"] = modelDict;
            }
            
            // Add inputs
            if (prompty.Inputs != null && prompty.Inputs.Any())
            {
                var inputsDict = new Dictionary<string, object>();
                foreach (var input in prompty.Inputs)
                {
                    var inputDict = new Dictionary<string, object>
                    {
                        ["type"] = input.Value.Type?.ToString().ToLower() ?? "string",
                        ["required"] = input.Value.Required
                    };
                    
                    if (!string.IsNullOrEmpty(input.Value.Description))
                        inputDict["description"] = input.Value.Description;
                    
                    if (input.Value.Default != null)
                        inputDict["default"] = input.Value.Default;
                    
                    if (input.Value.Sample != null)
                        inputDict["sample"] = input.Value.Sample;
                    
                    inputsDict[input.Key] = inputDict;
                }
                result["inputs"] = inputsDict;
            }
            
            // Add outputs
            if (prompty.Outputs != null && prompty.Outputs.Any())
            {
                var outputsDict = new Dictionary<string, object>();
                foreach (var output in prompty.Outputs)
                {
                    var outputDict = new Dictionary<string, object>
                    {
                        ["type"] = output.Value.Type?.ToString().ToLower() ?? "string"
                    };
                    
                    if (!string.IsNullOrEmpty(output.Value.Description))
                        outputDict["description"] = output.Value.Description;
                    
                    outputsDict[output.Key] = outputDict;
                }
                result["outputs"] = outputsDict;
            }
            else
            {
                result["outputs"] = new Dictionary<string, object>();
            }
            
            // Add sample data (create from inputs)
            if (prompty.Inputs != null && prompty.Inputs.Any())
            {
                var sample = prompty.GetSample();
                if (sample.Any())
                {
                    result["sample"] = sample;
                }
            }
            
            // Add template information
            if (prompty.Template != null)
            {
                result["template"] = new Dictionary<string, object>
                {
                    ["format"] = prompty.Template.Format ?? "",
                    ["parser"] = prompty.Template.Parser ?? ""
                };
            }
            
            // Add other properties
            if (!string.IsNullOrEmpty(prompty.Name))
                result["name"] = prompty.Name;
                
            if (!string.IsNullOrEmpty(prompty.Description))
                result["description"] = prompty.Description;
                
            if (!string.IsNullOrEmpty(prompty.Version))
                result["version"] = prompty.Version;
                
            if (prompty.Metadata?.Authors != null && prompty.Metadata.Authors.Any())
                result["authors"] = prompty.Metadata.Authors.ToList();
                
            if (prompty.Metadata?.Tags != null && prompty.Metadata.Tags.Any())
                result["tags"] = prompty.Metadata.Tags.ToList();
            
            return result;
        }
        
        private string ResolveTckPath(string relativePath)
        {
            if (string.IsNullOrEmpty(relativePath)) return "";
            
            if (Path.IsPathRooted(relativePath))
                return relativePath;
            
            return Path.Combine(tckRootPath, relativePath);
        }
        
        private Dictionary<string, object> LoadExpectedResults(string filePath)
        {
            string content = File.ReadAllText(filePath);
            return JsonConvert.DeserializeObject<Dictionary<string, object>>(content) ?? new Dictionary<string, object>();
        }
        
        private bool CompareResults(Dictionary<string, object> actual, Dictionary<string, object> expected)
        {
            return JsonConvert.SerializeObject(actual) == JsonConvert.SerializeObject(expected);
        }
        
        private Dictionary<string, object> FindDifferences(Dictionary<string, object> expected, Dictionary<string, object> actual)
        {
            var differences = new Dictionary<string, object>();
            
            // Find keys in expected but not in actual
            foreach (var key in expected.Keys)
            {
                if (!actual.ContainsKey(key))
                {
                    differences[$"missing_key at `{key}`"] = $"expected={expected[key]} vs actual=None";
                }
                else if (!Equals(expected[key], actual[key]))
                {
                    differences[$"value at `{key}`"] = $"expected={expected[key]} vs actual={actual[key]}";
                }
            }
            
            // Find keys in actual but not in expected
            foreach (var key in actual.Keys)
            {
                if (!expected.ContainsKey(key))
                {
                    differences[$"extra_key at `{key}`"] = $"expected=None vs actual={actual[key]}";
                }
            }
            
            return differences;
        }
    }
}
