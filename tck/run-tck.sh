#!/bin/bash

# Prompty Test Compatibility Kit (TCK) Master Runner
# This script coordinates TCK tests across all available runtimes and generates compatibility reports
# It delegates to individual runtime-specific runners for modular execution

set -e

# Configuration
TCK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$TCK_DIR/results"
REPORTS_DIR="$TCK_DIR/reports"

# Runtime-specific runner scripts
PYTHON_RUNNER="$TCK_DIR/python/run-tck.sh"
CSHARP_RUNNER="$TCK_DIR/csharp/run-tck.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to setup environment
setup_environment() {
    print_status "Setting up TCK environment..."
    
    # Create directories
    mkdir -p "$RESULTS_DIR"
    mkdir -p "$REPORTS_DIR"
    
    # Export environment variables for runtime-specific runners
    export AZURE_OPENAI_ENDPOINT="https://test.openai.azure.com"
    export AZURE_OPENAI_DEPLOYMENT="gpt-4"
    export MAX_TOKENS="200"
    
    # Export TCK configuration variables
    export TCK_OUTPUT_FORMAT="${OUTPUT_FORMAT:-json}"
    export TCK_DEBUG="${DEBUG_MODE:-false}"
    export TCK_PERFORMANCE_MODE="${PERFORMANCE_MODE:-false}"
    export TCK_CI_MODE="${CI_MODE:-false}"
    
    print_success "Environment setup complete"
}

# Function to run Python TCK using the runtime-specific runner
run_python_tck() {
    print_status "Delegating to Python TCK runner..."
    
    if [ ! -f "$PYTHON_RUNNER" ]; then
        print_error "Python TCK runner not found at $PYTHON_RUNNER"
        return 1
    fi
    
    if [ ! -x "$PYTHON_RUNNER" ]; then
        print_error "Python TCK runner is not executable: $PYTHON_RUNNER"
        return 1
    fi
    
    local output_file="$RESULTS_DIR/python-results.json"
    
    if "$PYTHON_RUNNER" "$output_file"; then
        print_success "Python TCK completed successfully"
        return 0
    else
        print_error "Python TCK failed"
        return 1
    fi
}

# Function to run C# TCK using the runtime-specific runner
run_csharp_tck() {
    print_status "Delegating to C# TCK runner..."
    
    if [ ! -f "$CSHARP_RUNNER" ]; then
        print_error "C# TCK runner not found at $CSHARP_RUNNER"
        return 1
    fi
    
    if [ ! -x "$CSHARP_RUNNER" ]; then
        print_error "C# TCK runner is not executable: $CSHARP_RUNNER"
        return 1
    fi
    
    local output_file="$RESULTS_DIR/csharp-results.json"
    
    if "$CSHARP_RUNNER" "$output_file"; then
        print_success "C# TCK completed successfully"
        return 0
    else
        print_error "C# TCK failed"
        return 1
    fi
}

# Function to generate comparison report
generate_report() {
    print_status "Generating compatibility report..."
    
    local result_files=()
    
    # Collect available result files
    for runtime in python csharp; do
        local result_file="$RESULTS_DIR/${runtime}-results.json"
        if [[ -f "$result_file" ]]; then
            result_files+=("$result_file")
        fi
    done
    
    if [[ ${#result_files[@]} -lt 2 ]]; then
        print_warning "Need at least 2 runtime results for comparison. Only found ${#result_files[@]} result file(s)."
        return 1
    fi
    
    local report_file="$REPORTS_DIR/compatibility-report.md"
    local json_report_file="$REPORTS_DIR/compatibility-report.json"
    
    # Determine Python command to use
    local python_cmd=""
    if [ -f "$TCK_DIR/../.venv/bin/python" ]; then
        python_cmd="$TCK_DIR/../.venv/bin/python"
    else
        python_cmd="python3"
    fi
    
    # Generate markdown report
    if "$python_cmd" "$TCK_DIR/tools/compare_runtimes.py" "${result_files[@]}" --output "$report_file" --format markdown; then
        print_success "Markdown report generated: $report_file"
    else
        print_error "Failed to generate markdown report"
        return 1
    fi
    
    # Generate JSON report
    if "$python_cmd" "$TCK_DIR/tools/compare_runtimes.py" "${result_files[@]}" --output "$json_report_file" --format json; then
        print_success "JSON report generated: $json_report_file"
    else
        print_error "Failed to generate JSON report"
        return 1
    fi
    
    return 0
}

# Function to display help
show_help() {
    cat << EOF
Prompty Test Compatibility Kit (TCK) Master Runner

This is the master runner that coordinates TCK tests across all available runtimes.
It delegates to runtime-specific runners for modular execution and generates compatibility reports.

Usage: $0 [OPTIONS]

OPTIONS:
    --runtime RUNTIME    Run TCK for specific runtime only (python, csharp)
    --quick             Run quick tests only (skip slow/comprehensive tests)
    --performance       Enable performance monitoring and metrics collection
    --debug             Enable debug mode with verbose output
    --help              Show this help message
    --version           Show TCK version
    --ci                CI mode - optimized for continuous integration
    --output-dir DIR    Custom output directory for results (default: results/)
    --format FORMAT     Output format (json, xml, junit) (default: json)

EXAMPLES:
    $0                          # Run full TCK for all runtimes
    $0 --runtime python         # Run TCK for Python only
    $0 --runtime csharp         # Run TCK for C# only
    $0 --quick --ci             # Quick run in CI mode
    $0 --performance --debug    # Full run with performance monitoring and debug

RUNTIME-SPECIFIC RUNNERS:
    python/run-tck.sh           # Python TCK runner (standalone)
    csharp/run-tck.sh           # C# TCK runner (standalone)

ENVIRONMENT VARIABLES:
    TCK_DEBUG               Enable debug mode (true/false)
    TCK_PERFORMANCE_MODE    Enable performance monitoring (true/false)
    TCK_OUTPUT_FORMAT       Default output format (json/xml/junit)
    TCK_TIMEOUT            Test timeout in seconds (default: 300)
    TCK_CI_MODE            Enable CI mode optimizations (true/false)

SUPPORTED RUNTIMES:
    python                 Python runtime implementation
    csharp                 C# (.NET) runtime implementation

For runtime-specific help, run:
    python/run-tck.sh --help
    csharp/run-tck.sh --help

EOF
}

# Parse command line arguments
RUNTIME_FILTER=""
QUICK_MODE=false
PERFORMANCE_MODE=false
DEBUG_MODE=false
CI_MODE=false
OUTPUT_FORMAT="json"
CUSTOM_OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --runtime)
            RUNTIME_FILTER="$2"
            shift 2
            ;;
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --performance)
            PERFORMANCE_MODE=true
            export TCK_PERFORMANCE_MODE=true
            shift
            ;;
        --debug)
            DEBUG_MODE=true
            export TCK_DEBUG=true
            shift
            ;;
        --ci)
            CI_MODE=true
            shift
            ;;
        --output-dir)
            CUSTOM_OUTPUT_DIR="$2"
            shift 2
            ;;
        --format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        --version)
            echo "Prompty TCK v1.0"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Override output directory if specified
if [ -n "$CUSTOM_OUTPUT_DIR" ]; then
    RESULTS_DIR="$CUSTOM_OUTPUT_DIR"
fi

# Set environment variables
export TCK_OUTPUT_FORMAT="${OUTPUT_FORMAT}"
if [ "$DEBUG_MODE" = true ]; then
    set -x
fi

# CI mode optimizations
if [ "$CI_MODE" = true ]; then
    export TCK_CI_MODE=true
    export TCK_PARALLEL_EXECUTION=true
    # Reduce verbosity in CI
    if [ "$DEBUG_MODE" = false ]; then
        exec > >(grep -v "^\[INFO\]" | grep -v "^Running test:")
    fi
fi

# Validate runtime if specified
if [[ -n "$RUNTIME_FILTER" && "$RUNTIME_FILTER" != "python" && "$RUNTIME_FILTER" != "csharp" ]]; then
    print_error "Invalid runtime: $RUNTIME_FILTER. Must be one of: python, csharp"
    exit 1
fi

# Main execution logic with runtime filtering
main() {
    print_status "Starting Prompty TCK v1.0 (Master Runner)"
    if [ "$QUICK_MODE" = true ]; then
        print_status "Running in quick mode"
    fi
    if [ "$PERFORMANCE_MODE" = true ]; then
        print_status "Performance monitoring enabled"
    fi
    if [ "$CI_MODE" = true ]; then
        print_status "Running in CI mode"
    fi
    
    setup_environment
    
    local python_result=0
    local csharp_result=0
    
    # Run tests based on runtime filter using delegated runners
    if [ -z "$RUNTIME_FILTER" ] || [ "$RUNTIME_FILTER" = "python" ]; then
        print_status "Running Python TCK via runtime-specific runner..."
        if ! run_python_tck; then
            python_result=1
        fi
    fi
    
    if [ -z "$RUNTIME_FILTER" ] || [ "$RUNTIME_FILTER" = "csharp" ]; then
        print_status "Running C# TCK via runtime-specific runner..."
        if ! run_csharp_tck; then
            csharp_result=1
        fi
    fi
    
    # Generate reports only if not filtered to single runtime
    if [ -z "$RUNTIME_FILTER" ]; then
        generate_report
    else
        print_status "Skipping report generation (single runtime mode)"
    fi
    
    # Exit with error code if any runtime failed
    local total_failures=$((python_result + csharp_result))
    if [ $total_failures -gt 0 ]; then
        print_error "TCK completed with $total_failures runtime failure(s)"
        exit 1
    else
        print_success "All TCK tests completed successfully"
        exit 0
    fi
}

# Run main function
main "$@"
