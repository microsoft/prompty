#!/bin/bash

# Pre-commit TCK validation script
# Run this before committing changes that affect the TCK

set -e

echo "🔍 Pre-commit TCK validation"
echo "============================="

# Check if we're in the right directory
if [ ! -f "run-tck.sh" ]; then
    echo "❌ Please run this script from the tck/ directory"
    exit 1
fi

# Step 1: Validate setup
echo "1️⃣ Validating TCK setup..."
python validate-setup.py
if [ $? -ne 0 ]; then
    echo "❌ Setup validation failed"
    exit 1
fi

# Step 2: Run quick TCK test
echo ""
echo "2️⃣ Running quick TCK validation..."
./run-tck.sh --runtime python
if [ $? -ne 0 ]; then
    echo "❌ Python TCK failed"
    exit 1
fi

./run-tck.sh --runtime csharp
if [ $? -ne 0 ]; then
    echo "❌ C# TCK failed" 
    exit 1
fi

# Step 3: Generate compatibility report
echo ""
echo "3️⃣ Generating compatibility report..."
./run-tck.sh > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Failed to generate compatibility report"
    exit 1
fi

# Step 4: Check compatibility threshold
echo ""
echo "4️⃣ Checking compatibility threshold..."
python tools/check_compatibility_threshold.py reports/compatibility-report.json --threshold 60
if [ $? -ne 0 ]; then
    echo "⚠️  Compatibility below threshold - please review changes"
    echo "   Review: reports/compatibility-report.md"
    # Don't exit with error - just warn
fi

echo ""
echo "✅ Pre-commit validation complete!"
echo ""
echo "📋 Summary:"
echo "   - TCK setup: ✅ Valid"
echo "   - Python runtime: ✅ Working"
echo "   - C# runtime: ✅ Working"
echo "   - Compatibility: ✅ Generated"
echo ""
echo "🚀 Ready to commit! The GitHub Actions workflow will run automatically."
