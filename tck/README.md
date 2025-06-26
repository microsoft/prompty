# Prompty Test Compatibility Kit (TCK)

The Prompty TCK ensures that all runtime implementations follow the same specification and produce compatible results. This comprehensive testing framework validates that Python, C#, and future runtime implementations (Java, JavaScript) are fully compatible and respect the [Prompty specification](../Prompty.yaml).

## Overview

The TCK validates compatibility across multiple dimensions:

1. **Specification Compliance** - All runtimes parse the same `.prompty` files identically
2. **Functional Equivalence** - Same inputs produce equivalent outputs across runtimes
3. **Error Handling** - Consistent error behavior for invalid inputs
4. **Template Rendering** - Identical template processing results
5. **Model Integration** - Consistent model configuration and execution
6. **Cross-Runtime Validation** - Direct comparison between runtime outputs

## Architecture

The TCK consists of several key components:

1. **Shared Test Data** (`testdata/`) - Common `.prompty` files and test cases
2. **Expected Results** (`expected/`) - Reference outputs for comparison
3. **Runtime Interfaces** (`interface/`) - Optional common interface for standardization
4. **Runtime Implementations** - Language-specific TCK implementations
5. **Comparison Tools** (`tools/`) - Cross-runtime result analysis
6. **Test Runner** (`run-tck.sh`) - Main orchestration script

## Test Categories

### Specification Tests
Verify that all runtimes parse `.prompty` files identically:
- YAML frontmatter parsing
- Metadata extraction (name, description, authors, etc.)
- Model configuration parsing
- Input/output specifications
- Sample data extraction

### Functional Tests
Verify that runtimes produce equivalent outputs:
- Template rendering with Jinja2
- Variable substitution
- Environment variable resolution
- Complex template features (loops, conditionals)
- Function calling configuration

### Error Handling Tests
Verify consistent error behavior:
- Invalid YAML handling
- Missing required inputs
- Type validation errors
- Template syntax errors

### Integration Tests
End-to-end compatibility verification:
- Cross-runtime output comparison
- Performance benchmarking
- Configuration override behavior

## Running the TCK

### Prerequisites

- Python 3.11+ (for Python runtime and comparison tools)
- .NET 9+ SDK (for C# runtime)
- Java 21+ JDK (for Java runtime, when available)
- Node.js 19+ (for JavaScript runtime, when available)

### Basic Usage

```bash
# Run TCK for all available runtimes
./run-tck.sh

# Run TCK for specific runtime only
./run-tck.sh --runtime python
./run-tck.sh --runtime csharp

# Run with performance monitoring
./run-tck.sh --performance

# Run in CI mode with optimizations
./run-tck.sh --ci

# Run quick tests only
./run-tck.sh --quick

# Enable debug mode
./run-tck.sh --debug
```

### Advanced Usage

```bash
# Compare specific runtimes
python tck/tools/compare_runtimes.py \
  results/python-results.json \
  results/csharp-results.json \
  --output reports/py-cs-comparison.md

# Generate JSON report for CI/CD integration
python tck/tools/compare_runtimes.py \
  results/*.json \
  --format json \
  --output reports/tck-results.json

# Check compatibility threshold
python tools/check_compatibility_threshold.py results/compatibility-report.json
```

### Windows Support

```powershell
# PowerShell runner for Windows
.\run-tck.ps1 -Runtime python
.\run-tck.ps1 -Runtime csharp
.\run-tck.ps1 -Runtime all
.\run-tck.ps1 -Quick
```

### Validation and Setup

```bash
# Validate setup before committing
./pre-commit-check.sh

# Validate TCK configuration
python validate-setup.py
```

## Implementing a New Runtime

To add TCK support for a new runtime:

1. **Create Runtime Directory**
   ```bash
   mkdir tck/newruntime
   ```

2. **Implement TCK Logic**
   
   Create functions that implement the core TCK functionality:
   - `parse_prompty()` - Parse .prompty content into structured format
   - `render_template()` - Render template with input data
   - `validate_inputs()` - Validate inputs against specification
   - `get_sample_data()` - Extract sample data from prompty

3. **Create Test Runner**
   
   Implement a test runner that:
   - Loads test specifications from `tck-tests.json`
   - Executes tests using your runtime implementation
   - Outputs results in the standard JSON format

4. **Add to Main Runner**
   
   Update `run-tck.sh` to include your new runtime.

### Example Implementation Structure

```
tck/newruntime/
├── newruntime_tck.py      # Main TCK implementation
├── requirements.txt       # Dependencies (if needed)
├── README.md             # Runtime-specific setup instructions
└── test_runner.py        # Test execution script
```

## Result Format

All runtime implementations must output results in this JSON format:

```json
[
  {
    "test_id": "basic-parsing",
    "result": "pass|fail|skip|error",
    "runtime": "python",
    "execution_time_ms": 123.45,
    "output": { /* test-specific output */ },
    "error_message": "Error details (if result=error)",
    "error_type": "ExceptionType (if result=error)"
  }
]
```

## Adding New Tests

1. **Create Test Data**
   - Add new `.prompty` file to `testdata/`
   - Create expected results in `expected/` if needed

2. **Update Test Specification**
   - Add test case to `tck-tests.json`
   - Specify test category and expected behavior

3. **Test Across Runtimes**
   - Run TCK to verify all runtimes handle the new test
   - Update runtime implementations if needed

### Test Specification Format

```json
{
  "id": "unique-test-id",
  "name": "Human readable test name",
  "description": "Test description",
  "category": "specification|functional|integration|error-handling",
  "prompty_file": "testdata/test.prompty",
  "input_data": { /* optional input data */ },
  "environment_vars": { /* optional env vars */ },
  "expected_errors": [ /* for error tests */ ],
  "skip_runtimes": [ /* runtimes to skip */ ]
}
```

## Continuous Integration

### GitHub Actions CI/CD Integration

The Prompty TCK includes a comprehensive GitHub Actions workflow that automatically runs compatibility tests across multiple platforms and runtime combinations.

#### Workflow Overview

The TCK workflow (`.github/workflows/tck.yml`) provides:

- **Multi-platform testing**: Ubuntu, Windows, and macOS
- **Cross-runtime compatibility**: Python and C# runtimes
- **Automated reporting**: Compatibility reports and PR comments
- **Artifact management**: Test results and detailed logs
- **Notification system**: Slack/Teams integration for failures
- **Threshold monitoring**: Automatic issue creation for regressions

#### Workflow Triggers

The workflow runs automatically on:

```yaml
# Push to main branches
- push:
    branches: [ main, develop ]
    paths: [ 'runtime/**', 'tck/**' ]

# Pull requests  
- pull_request:
    branches: [ main, develop ]
    paths: [ 'runtime/**', 'tck/**' ]

# Daily scheduled runs at 2 AM UTC
- schedule:
    - cron: '0 2 * * *'

# Manual workflow dispatch
- workflow_dispatch:
    inputs:
      runtime: # python, csharp, all
      generate_report: # true/false
```

#### Workflow Jobs

1. **`tck-matrix`** - Core TCK Testing
   - Runs TCK across matrix of OS and runtime combinations
   - Builds and tests each runtime implementation
   - Uploads test results and logs as artifacts
   - Generates test summaries in GitHub Actions UI

2. **`compatibility-report`** - Cross-Runtime Analysis
   - Downloads results from all matrix runs
   - Generates markdown and JSON compatibility reports
   - Checks compatibility threshold (default: 80%)
   - Posts results as PR comments
   - Creates issues for compatibility regressions

3. **`runtime-specific-tests`** - Validation
   - Validates JSON format compliance
   - Checks required field presence
   - Verifies runtime consistency
   - Ensures output format standards

4. **`publish-results`** - Result Publishing
   - Deploys reports to GitHub Pages (optional)
   - Creates GitHub releases for scheduled runs
   - Archives results for historical tracking

5. **`notification`** - Status Reporting
   - Determines overall workflow status
   - Sends notifications for failures (Slack/Teams)
   - Creates workflow summaries
   - Provides actionable next steps

#### Setting Up the Workflow

**Prerequisites**: The workflow requires specific repository structure:
- `/runtime/prompty/` - Python runtime implementation
- `/runtime/promptycs/` - C# runtime implementation  
- `/tck/` - TCK test suite and runners

**Optional Configuration**: Set these repository secrets for enhanced features:

```bash
# Notification webhooks (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...

# GitHub token is automatically provided
GITHUB_TOKEN=<auto-generated>
```

#### Example Workflow Output

```markdown
## 🔄 Prompty TCK Compatibility Report

**Overall Compatibility Rate: 85.7%**

### Summary
- Total tests: 14
- Compatible tests: 12  
- Incompatible tests: 2

### Runtime Matrix Results
✅ Python on Ubuntu: 14/14 tests passed
✅ C# on Ubuntu: 14/14 tests passed  
✅ Python on Windows: 14/14 tests passed
⚠️  C# on Windows: 12/14 tests passed

### Incompatible Tests
- `template-escaping`: Output format differences
- `unicode-handling`: Character encoding variations

---
📊 *Generated by Prompty TCK Workflow*
```

### Manual CI Integration

The TCK can be integrated into other CI/CD pipelines:

1. **Run TCK in CI**
   ```yaml
   - name: Run Prompty TCK
     run: |
       cd tck
       ./run-tck.sh --runtime python --runtime csharp
   ```

2. **Check Compatibility**
   ```yaml
   - name: Check Runtime Compatibility
     run: |
       cd tck
       python tools/compare_runtimes.py results/*.json --format json
   ```

3. **Publish Results**
   - Archive test results as CI artifacts
   - Generate compatibility reports
   - Set up notifications for compatibility regressions

## Ensuring Cross-Runtime Compatibility

### Standard Output Format

All runtime implementations **MUST** produce output in the exact same JSON structure to ensure compatibility. The expected format is:

```json
{
  "metadata": {
    "name": "Prompty Name",
    "description": "Description", 
    "version": "1.0",
    "authors": ["author1", "author2"],
    "tags": ["tag1", "tag2"]
  },
  "model": {
    "api": "chat",
    "configuration": {
      "type": "openai",
      "model": "gpt-3.5-turbo"
    },
    "parameters": {
      "max_tokens": 100,
      "temperature": 0.0
    },
    "response": "first"
  },
  "inputs": {
    "field_name": {
      "type": "string|number|boolean|array|object",
      "description": "Field description",
      "required": true,
      "default": "default_value"
    }
  },
  "outputs": {
    "field_name": {
      "type": "string",
      "description": "Output description"
    }
  },
  "sample": {
    "field_name": "sample_value"
  },
  "template": {
    "format": "jinja2",
    "parser": "prompty"
  },
  "content": "Template content with variables"
}
```

### Critical Compatibility Requirements

1. **Data Type Consistency**
   - Numbers MUST be serialized as JSON numbers, not strings
   - Booleans MUST be `true`/`false`, not `"true"`/`"false"`
   - Arrays MUST be JSON arrays `[]`, not serialized strings
   - Objects MUST be JSON objects `{}`, not serialized strings

2. **Field Name Standardization**
   - Use exact field names from the specification
   - Do not add runtime-specific prefixes or suffixes
   - Include all required fields even if empty (use `{}` or `[]`)

3. **Template Format Reporting**
   - Parse template format from YAML frontmatter first
   - Report the actual format used (usually "jinja2")
   - Do not report runtime-specific template engine names

4. **Error Handling Consistency**
   ```json
   {
     "test_id": "test-name",
     "result": "error",
     "runtime": "your-runtime",
     "execution_time_ms": 123.45,
     "error_message": "Human readable error message",
     "error_type": "StandardErrorType"
   }
   ```

### Implementation Checklist for New Runtimes

Before submitting a new runtime implementation, verify:

- [ ] All tests in `tck-tests.json` execute (pass, fail, or error - no crashes)
- [ ] Output format exactly matches expected JSON structure
- [ ] Numbers are JSON numbers, not strings
- [ ] Required fields are always present (even if empty)
- [ ] Template format matches what's in the `.prompty` file
- [ ] Error messages follow standard patterns
- [ ] Compatibility rate >90% with existing runtimes
- [ ] Performance within 2x of reference implementations

### Testing Your Implementation

1. **Run TCK for your runtime only**:
   ```bash
   ./run-tck.sh --runtime yourruntime
   ```

2. **Compare with reference implementation**:
   ```bash
   python tools/compare_runtimes.py \
     results/python-results.json \
     results/yourruntime-results.json \
     --format json
   ```

3. **Analyze specific differences**:
   ```bash
   python tools/compare_runtimes.py \
     results/python-results.json \
     results/yourruntime-results.json \
     --detailed --test basic-parsing
   ```

4. **Check compatibility rate**:
   ```bash
   python tools/check_compatibility_threshold.py results/compatibility-report.json
   ```

### Output Normalization Guidelines

When converting from your runtime's native format to TCK format:

```pseudo
// Example normalization
function normalizeForTCK(runtimeOutput) {
  return {
    metadata: extractMetadata(runtimeOutput),
    model: normalizeModel(runtimeOutput.model),
    inputs: normalizeInputs(runtimeOutput.inputs),
    outputs: normalizeOutputs(runtimeOutput.outputs),
    sample: normalizeSample(runtimeOutput.sample),
    template: {
      format: runtimeOutput.template?.format || "jinja2",
      parser: runtimeOutput.template?.parser || "prompty"
    },
    content: runtimeOutput.content
  }
}

function normalizeModel(model) {
  return {
    api: model.api || "chat",
    configuration: model.configuration || {},
    parameters: ensureNumericTypes(model.parameters || {}),
    response: model.response || "first"
  }
}
```

## Monitoring and Maintenance

### Regular Maintenance Tasks

1. **Review Compatibility Trends**
   - Monitor daily compatibility reports
   - Track regression patterns
   - Update thresholds as needed

2. **Update Runtime Matrix**
   - Add new runtime implementations
   - Update OS versions periodically
   - Adjust exclusions based on support

3. **Maintain Test Coverage**
   - Add tests for new features
   - Update expected results
   - Expand error handling scenarios

### Troubleshooting Common Issues

**Build Failures:**
```bash
# Check .NET versions
dotnet --list-runtimes

# Verify Python dependencies
pip list

# Review build logs in GitHub Actions
```

**Compatibility Regressions:**
```bash
# Run TCK locally
./run-tck.sh

# Compare specific results
python tools/compare_runtimes.py results/python-results.json results/csharp-results.json

# Analyze specific test differences
python tools/compare_runtimes.py --detailed --test basic-parsing
```

**Workflow Permissions:**
- Ensure repository has Actions enabled
- Verify GITHUB_TOKEN permissions for PR comments
- Check organization settings for workflow restrictions

### Best Practices

1. **Test Locally First**
   ```bash
   # Always run TCK locally before pushing
   cd tck && ./run-tck.sh
   ```

2. **Monitor Compatibility**
   - Set up notifications for compatibility drops
   - Review weekly compatibility trends
   - Address issues promptly

3. **Documentation Updates**
   - Update compatibility requirements in README
   - Document known compatibility issues
   - Maintain implementation guides

4. **Performance Optimization**
   - Use matrix exclusions to reduce CI time
   - Cache dependencies where possible
   - Optimize test execution order

## Environment Variables

The TCK supports several environment variables for configuration:

- `TCK_DEBUG` - Enable debug mode (true/false)
- `TCK_PERFORMANCE_MODE` - Enable performance monitoring (true/false)
- `TCK_OUTPUT_FORMAT` - Default output format (json/xml/junit)
- `TCK_TIMEOUT` - Test timeout in seconds (default: 300)
- `TCK_CI_MODE` - Enable CI mode optimizations (true/false)

## File Structure

```
tck/
├── run-tck.sh                 # Main test runner (Unix/Linux/macOS)
├── run-tck.ps1                # PowerShell runner (Windows)
├── validate-setup.py          # Setup validation script
├── pre-commit-check.sh         # Pre-commit validation
├── tck-tests.json             # Test specifications
├── tck-schema.json            # Result format schema
├── python/                    # Python TCK implementation
│   ├── run-tck.sh
│   └── python_tck.py
├── csharp/                    # C# TCK implementation
│   ├── run-tck.sh
│   ├── CSharpTCK.cs
│   └── CSharpTCK.csproj
├── interface/                 # Optional shared interfaces
│   └── tck_interface.py
├── testdata/                  # Shared test data
│   ├── basic-parsing.prompty
│   ├── complex-template.prompty
│   └── ...
├── expected/                  # Expected results
├── results/                   # Generated test results
├── reports/                   # Compatibility reports
└── tools/                     # Analysis and comparison tools
    ├── compare_runtimes.py
    └── check_compatibility_threshold.py
```

## Related Documentation

- [`IMPLEMENTATION.md`](IMPLEMENTATION.md) - Detailed implementation guide
- [`INTERFACE-SIMPLIFICATION.md`](INTERFACE-SIMPLIFICATION.md) - Interface design changes
- [`TCK_COMPATIBILITY_ANALYSIS.md`](TCK_COMPATIBILITY_ANALYSIS.md) - Compatibility analysis
- [`WORKFLOW-SUMMARY.md`](WORKFLOW-SUMMARY.md) - GitHub Actions workflow details
- [`.github/workflows/tck.yml`](../.github/workflows/tck.yml) - CI/CD workflow configuration

The GitHub Actions workflow provides comprehensive automation for maintaining runtime compatibility and catching regressions early in the development cycle.
