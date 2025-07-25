# PowerShell script for running TCK on Windows
param(
    [string]$Runtime = "all",
    [string]$Category = "all",
    [switch]$Clean = $false,
    [switch]$Compare = $false,
    [switch]$Help = $false
)

if ($Help) {
    Write-Host "Prompty TCK Runner (Windows PowerShell)"
    Write-Host ""
    Write-Host "Usage: ./run-tck.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Runtime <runtime>   Run TCK for specific runtime (python, csharp, all)"
    Write-Host "  -Category <category> Run specific test category (specification, functional, error-handling, all)"
    Write-Host "  -Clean              Clean previous results before running"
    Write-Host "  -Compare            Generate comparison report from existing results"
    Write-Host "  -Help               Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  ./run-tck.ps1                    # Run all runtimes"
    Write-Host "  ./run-tck.ps1 -Runtime python    # Run Python TCK only"
    Write-Host "  ./run-tck.ps1 -Runtime csharp    # Run C# TCK only"
    Write-Host "  ./run-tck.ps1 -Clean             # Clean and run all"
    Write-Host "  ./run-tck.ps1 -Compare           # Generate comparison report"
    exit 0
}

Write-Host "[INFO] Starting Prompty TCK v1.0 (Windows PowerShell)"

# Clean previous results if requested
if ($Clean) {
    Write-Host "[INFO] Cleaning previous results..."
    if (Test-Path "results") {
        Remove-Item -Recurse -Force "results"
    }
    if (Test-Path "reports") {
        Remove-Item -Recurse -Force "reports"
    }
}

# Create directories
New-Item -ItemType Directory -Force -Path "results" | Out-Null
New-Item -ItemType Directory -Force -Path "reports" | Out-Null

# Only generate comparison report
if ($Compare) {
    Write-Host "[INFO] Generating compatibility report..."
    if (Test-Path "results/python-results.json" -And Test-Path "results/csharp-results.json") {
        python tools/compare_runtimes.py results/python-results.json results/csharp-results.json --output reports/compatibility-report.md
        python tools/compare_runtimes.py results/python-results.json results/csharp-results.json --format json --output reports/compatibility-report.json
        Write-Host "[SUCCESS] Compatibility report generated"
    } else {
        Write-Host "[ERROR] Missing result files for comparison"
        exit 1
    }
    exit 0
}

$exitCode = 0

# Run Python TCK
if ($Runtime -eq "python" -or $Runtime -eq "all") {
    Write-Host "[INFO] Running Python TCK..."
    
    Push-Location "python"
    try {
        python python_tck.py ../tck-tests.json ../results/python-results.json
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[SUCCESS] Python TCK completed successfully"
        } else {
            Write-Host "[ERROR] Python TCK failed with exit code $LASTEXITCODE"
            $exitCode = 1
        }
    } catch {
        Write-Host "[ERROR] Python TCK execution failed: $($_.Exception.Message)"
        $exitCode = 1
    } finally {
        Pop-Location
    }
}

# Run C# TCK
if ($Runtime -eq "csharp" -or $Runtime -eq "all") {
    Write-Host "[INFO] Running C# TCK..."
    
    Push-Location "csharp"
    try {
        Write-Host "[INFO] Building C# TCK project..."
        dotnet build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] C# TCK build failed"
            $exitCode = 1
        } else {
            dotnet run ../tck-tests.json ../results/csharp-results.json
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[SUCCESS] C# TCK completed successfully"
            } else {
                Write-Host "[ERROR] C# TCK failed with exit code $LASTEXITCODE"
                $exitCode = 1
            }
        }
    } catch {
        Write-Host "[ERROR] C# TCK execution failed: $($_.Exception.Message)"
        $exitCode = 1
    } finally {
        Pop-Location
    }
}

# Generate comparison report if multiple runtimes were run
if ($Runtime -eq "all" -and $exitCode -eq 0) {
    Write-Host "[INFO] Generating compatibility report..."
    if (Test-Path "results/python-results.json" -And Test-Path "results/csharp-results.json") {
        python tools/compare_runtimes.py results/python-results.json results/csharp-results.json --output reports/compatibility-report.md
        python tools/compare_runtimes.py results/python-results.json results/csharp-results.json --format json --output reports/compatibility-report.json
        Write-Host "[SUCCESS] Compatibility report generated"
    } else {
        Write-Host "[WARNING] Cannot generate comparison report - missing result files"
    }
}

if ($exitCode -eq 0) {
    Write-Host "[SUCCESS] All TCK tests completed successfully"
} else {
    Write-Host "[ERROR] TCK execution completed with errors"
}

exit $exitCode
