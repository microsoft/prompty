#!/bin/bash

# Python TCK Runner
# This script runs TCK tests for the Python runtime implementation

set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TCK_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
PYTHON_TCK="$SCRIPT_DIR/python_tck.py"
TEST_FILE="$TCK_ROOT/tck-tests.json"

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

# Function to run Python TCK
run_python_tck() {
    print_status "Running Python TCK..."
    
    # Check for virtual environment Python first, then system Python
    local python_cmd=""
    if [ -f "$TCK_ROOT/../.venv/bin/python" ]; then
        python_cmd="$TCK_ROOT/../.venv/bin/python"
    elif command_exists python3; then
        python_cmd="python3"
    else
        print_error "Python 3 not found."
        return 1
    fi
    
    # Check if Python prompty is available
    if ! "$python_cmd" -c "import prompty" 2>/dev/null; then
        print_error "Python prompty runtime not found."
        return 1
    fi
    
    local output_file="$1"
    if [ -z "$output_file" ]; then
        output_file="$TCK_ROOT/results/python-results.json"
    fi
    
    # Ensure output directory exists
    mkdir -p "$(dirname "$output_file")"
    
    # Set environment variables for tests
    export AZURE_OPENAI_ENDPOINT="https://test.openai.azure.com"
    export AZURE_OPENAI_DEPLOYMENT="gpt-4"
    export MAX_TOKENS="200"
    
    cd "$TCK_ROOT"
    if "$python_cmd" "$PYTHON_TCK" "$TEST_FILE" "$output_file"; then
        print_success "Python TCK completed successfully"
        return 0
    else
        print_error "Python TCK failed"
        return 1
    fi
}

# Function to display help
show_help() {
    cat << EOF
Python TCK Runner

Usage: $0 [OUTPUT_FILE]

ARGUMENTS:
    OUTPUT_FILE    Optional path to output results file
                   (default: ../results/python-results.json)

EXAMPLES:
    $0                              # Run with default output
    $0 custom-results.json          # Run with custom output file
    $0 /path/to/results.json        # Run with absolute path

ENVIRONMENT VARIABLES:
    TCK_DEBUG               Enable debug mode (true/false)
    AZURE_OPENAI_ENDPOINT   Override OpenAI endpoint for tests
    AZURE_OPENAI_DEPLOYMENT Override OpenAI deployment name
    MAX_TOKENS             Override max tokens setting

EOF
}

# Parse command line arguments
if [[ $# -gt 1 ]]; then
    print_error "Too many arguments"
    show_help
    exit 1
fi

if [[ $# -eq 1 ]]; then
    if [[ "$1" == "--help" || "$1" == "-h" ]]; then
        show_help
        exit 0
    fi
    OUTPUT_FILE="$1"
else
    OUTPUT_FILE=""
fi

# Set debug mode if requested
if [ "$TCK_DEBUG" = "true" ]; then
    set -x
fi

# Main execution
main() {
    run_python_tck "$OUTPUT_FILE"
}

# Run main function
main
