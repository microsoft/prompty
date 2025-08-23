#!/usr/bin/env python3
"""
Validate TCK workflow setup.

This script checks that all necessary components are in place
for the GitHub Actions TCK workflow to run successfully.
"""

import os
import sys
from pathlib import Path


def check_file_exists(path: Path, description: str) -> bool:
    """Check if a file exists and report the result."""
    if path.exists():
        print(f"✅ {description}: {path}")
        return True
    else:
        print(f"❌ {description}: {path} (NOT FOUND)")
        return False


def check_executable(path: Path, description: str) -> bool:
    """Check if a file exists and is executable."""
    if path.exists() and os.access(path, os.X_OK):
        print(f"✅ {description}: {path} (executable)")
        return True
    elif path.exists():
        print(f"⚠️  {description}: {path} (exists but not executable)")
        return False
    else:
        print(f"❌ {description}: {path} (NOT FOUND)")
        return False


def main():
    """Main validation function."""
    print("🔍 Validating TCK Workflow Setup")
    print("=" * 50)
    
    # Get the repository root (should be parent of tck directory)
    tck_dir = Path(__file__).parent
    repo_root = tck_dir.parent
    
    issues = []
    
    # Check workflow file
    workflow_file = repo_root / ".github" / "workflows" / "tck.yml"
    if not check_file_exists(workflow_file, "GitHub Actions workflow"):
        issues.append("Missing workflow file")
    
    # Check TCK runners
    main_runner = tck_dir / "run-tck.sh"
    if not check_executable(main_runner, "Main TCK runner"):
        issues.append("Main runner not executable")
    
    ps_runner = tck_dir / "run-tck.ps1"
    if not check_file_exists(ps_runner, "PowerShell TCK runner"):
        issues.append("Missing PowerShell runner")
    
    # Check runtime-specific runners
    python_runner = tck_dir / "python" / "run-tck.sh"
    if not check_executable(python_runner, "Python TCK runner"):
        issues.append("Python runner not executable")
    
    csharp_runner = tck_dir / "csharp" / "run-tck.sh"
    if not check_executable(csharp_runner, "C# TCK runner"):
        issues.append("C# runner not executable")
    
    # Check TCK test data
    test_spec = tck_dir / "tck-tests.json"
    if not check_file_exists(test_spec, "TCK test specification"):
        issues.append("Missing test specification")
    
    # Check runtime implementations
    python_tck = tck_dir / "python" / "python_tck.py"
    if not check_file_exists(python_tck, "Python TCK implementation"):
        issues.append("Missing Python TCK implementation")
    
    csharp_tck = tck_dir / "csharp" / "CSharpTCK.cs"
    if not check_file_exists(csharp_tck, "C# TCK implementation"):
        issues.append("Missing C# TCK implementation")
    
    csharp_proj = tck_dir / "csharp" / "CSharpTCK.csproj"
    if not check_file_exists(csharp_proj, "C# project file"):
        issues.append("Missing C# project file")
    
    # Check runtime libraries
    python_runtime = repo_root / "runtime" / "prompty"
    if not check_file_exists(python_runtime, "Python runtime directory"):
        issues.append("Missing Python runtime")
    
    csharp_runtime = repo_root / "runtime" / "promptycs"
    if not check_file_exists(csharp_runtime, "C# runtime directory"):
        issues.append("Missing C# runtime")
    
    # Check comparison tools
    compare_tool = tck_dir / "tools" / "compare_runtimes.py"
    if not check_file_exists(compare_tool, "Runtime comparison tool"):
        issues.append("Missing comparison tool")
    
    threshold_tool = tck_dir / "tools" / "check_compatibility_threshold.py"
    if not check_executable(threshold_tool, "Compatibility threshold checker"):
        issues.append("Threshold checker not executable")
    
    # Check directories
    required_dirs = [
        (tck_dir / "testdata", "Test data directory"),
        (tck_dir / "expected", "Expected results directory"),
        (tck_dir / "results", "Results directory (may be created)"),
        (tck_dir / "reports", "Reports directory (may be created)")
    ]
    
    for dir_path, description in required_dirs:
        if dir_path.exists():
            print(f"✅ {description}: {dir_path}")
        else:
            print(f"⚠️  {description}: {dir_path} (will be created if needed)")
    
    # Summary
    print("\n" + "=" * 50)
    if issues:
        print(f"❌ Found {len(issues)} issue(s):")
        for issue in issues:
            print(f"   - {issue}")
        print("\nPlease fix these issues before running the TCK workflow.")
        return 1
    else:
        print("✅ All checks passed! TCK workflow should work correctly.")
        
        # Additional recommendations
        print("\n🔧 Recommendations:")
        print("   - Test locally: ./run-tck.sh")
        print("   - Verify .NET version: dotnet --version")
        print("   - Check Python version: python --version")
        print("   - Review workflow: .github/workflows/tck.yml")
        
        return 0


if __name__ == "__main__":
    sys.exit(main())
