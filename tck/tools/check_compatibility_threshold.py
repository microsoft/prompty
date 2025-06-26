#!/usr/bin/env python3
"""
Check compatibility threshold for TCK results.

This tool validates that the compatibility rate between runtimes
meets the minimum threshold requirements.
"""

import argparse
import json
import sys
from pathlib import Path


def check_compatibility_threshold(report_file: Path, threshold: float) -> bool:
    """
    Check if compatibility rate meets the threshold.
    
    Args:
        report_file: Path to the compatibility report JSON file
        threshold: Minimum compatibility rate (0-100)
        
    Returns:
        True if threshold is met, False otherwise
    """
    try:
        with open(report_file, 'r') as f:
            report = json.load(f)
        
        # Handle both report formats
        if isinstance(report, list):
            # List format: array of test results
            total_tests = len(report)
            compatible_tests = len([test for test in report if test.get('compatible', False)])
            compatibility_rate = (compatible_tests / total_tests) * 100 if total_tests > 0 else 0
            
            print(f"Current compatibility rate: {compatibility_rate:.1f}%")
            print(f"Required threshold: {threshold:.1f}%")
            
            if compatibility_rate >= threshold:
                print(f"✅ Compatibility threshold met ({compatibility_rate:.1f}% >= {threshold:.1f}%)")
                return True
            else:
                print(f"❌ Compatibility threshold not met ({compatibility_rate:.1f}% < {threshold:.1f}%)")
                
                # Show incompatible tests
                incompatible_tests = [test for test in report if not test.get('compatible', False)]
                if incompatible_tests:
                    print(f"\nIncompatible tests: {len(incompatible_tests)}")
                    for i, test in enumerate(incompatible_tests[:5]):
                        test_id = test.get('test_id', f'test_{i}')
                        differences = test.get('differences', [])
                        if differences:
                            reason = differences[0].get('type', 'Unknown reason')
                        else:
                            reason = 'No differences recorded'
                        print(f"  - {test_id}: {reason}")
                    
                    if len(incompatible_tests) > 5:
                        print(f"  ... and {len(incompatible_tests) - 5} more")
                
                return False
        else:
            # Object format: report with overall_compatibility_rate
            compatibility_rate = report.get('overall_compatibility_rate', 0) * 100
            
            print(f"Current compatibility rate: {compatibility_rate:.1f}%")
            print(f"Required threshold: {threshold:.1f}%")
            
            if compatibility_rate >= threshold:
                print(f"✅ Compatibility threshold met ({compatibility_rate:.1f}% >= {threshold:.1f}%)")
                return True
            else:
                print(f"❌ Compatibility threshold not met ({compatibility_rate:.1f}% < {threshold:.1f}%)")
                
                # Show which tests are causing issues
                if 'incompatible_tests' in report:
                    incompatible_count = len(report['incompatible_tests'])
                    print(f"\nIncompatible tests: {incompatible_count}")
                    
                    # Show a few examples
                    for i, test in enumerate(report['incompatible_tests'][:5]):
                        test_id = test.get('test_id', f'test_{i}')
                        reason = test.get('reason', 'Unknown reason')
                        print(f"  - {test_id}: {reason}")
                    
                    if incompatible_count > 5:
                        print(f"  ... and {incompatible_count - 5} more")
                
                return False
            
    except FileNotFoundError:
        print(f"❌ Report file not found: {report_file}")
        return False
    except json.JSONDecodeError as e:
        print(f"❌ Invalid JSON in report file: {e}")
        return False
    except Exception as e:
        print(f"❌ Error reading report: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Check TCK compatibility threshold")
    parser.add_argument("report_file", type=Path, help="Path to compatibility report JSON file")
    parser.add_argument("--threshold", type=float, default=80.0, 
                       help="Minimum compatibility rate threshold (default: 80.0)")
    
    args = parser.parse_args()
    
    if not args.report_file.exists():
        print(f"❌ Report file does not exist: {args.report_file}")
        sys.exit(1)
    
    if not (0 <= args.threshold <= 100):
        print("❌ Threshold must be between 0 and 100")
        sys.exit(1)
    
    success = check_compatibility_threshold(args.report_file, args.threshold)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
