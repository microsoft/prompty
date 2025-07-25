#!/usr/bin/env python3
"""
Cross-runtime comparison tool for Prompty TCK results.
"""

import json
import argparse
import sys
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from pathlib import Path
import difflib


@dataclass
class RuntimeResult:
    runtime: str
    test_id: str
    result: str
    execution_time_ms: float
    output: Any
    error_message: Optional[str] = None
    error_type: Optional[str] = None


@dataclass
class ComparisonResult:
    test_id: str
    compatible: bool
    runtimes_tested: List[str]
    differences: List[Dict[str, Any]]
    notes: Optional[str] = None


def normalize_output(output: Any) -> Any:
    """Normalize output for cross-runtime comparison."""
    if isinstance(output, dict):
        # Sort keys for consistent ordering
        return {k: normalize_output(v) for k, v in sorted(output.items())}
    elif isinstance(output, list):
        return [normalize_output(item) for item in output]
    elif output is None:
        return None
    elif isinstance(output, (int, float, str, bool)):
        return output
    else:
        # Convert other types to string representation
        return str(output)


def load_runtime_results(file_path: str) -> List[RuntimeResult]:
    """Load test results from a runtime result file."""
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    # Handle both formats: simple array and metadata wrapper
    runtime_name = 'unknown'
    if isinstance(data, list):
        # Simple array format (like Python TCK)
        test_results = data
    elif isinstance(data, dict) and 'results' in data:
        # Metadata wrapper format (like C# TCK)
        test_results = data['results']
        # Extract runtime from metadata if available
        if 'metadata' in data and 'runtime' in data['metadata']:
            runtime_name = data['metadata']['runtime']
    else:
        raise ValueError(f"Unknown result format in {file_path}")
    
    results = []
    for item in test_results:
        # Handle different field names between implementations
        runtime = item.get('runtime') or runtime_name
        test_id = item.get('test_id') or item.get('id', 'unknown')
        result = item.get('result') or item.get('status', 'unknown')
        execution_time = item.get('execution_time_ms') or item.get('execution_time_ms', 0)
        output = item.get('output') or item.get('actual')
        error_message = item.get('error_message') or item.get('error') or item.get('message')
        error_type = item.get('error_type')
        
        results.append(RuntimeResult(
            runtime=runtime,
            test_id=test_id,
            result=result,
            execution_time_ms=execution_time,
            output=output,
            error_message=error_message,
            error_type=error_type
        ))
    
    return results


def compare_outputs(output1: Any, output2: Any, path: str = "") -> List[Dict[str, Any]]:
    """Compare two outputs and return list of differences."""
    differences = []
    
    norm1 = normalize_output(output1)
    norm2 = normalize_output(output2)
    
    if norm1 != norm2:
        if isinstance(norm1, dict) and isinstance(norm2, dict):
            # Compare dictionaries
            all_keys = set(norm1.keys()) | set(norm2.keys())
            for key in all_keys:
                key_path = f"{path}.{key}" if path else key
                if key not in norm1:
                    differences.append({
                        "path": key_path,
                        "type": "missing_key",
                        "runtime1_value": None,
                        "runtime2_value": norm2[key]
                    })
                elif key not in norm2:
                    differences.append({
                        "path": key_path,
                        "type": "extra_key",
                        "runtime1_value": norm1[key],
                        "runtime2_value": None
                    })
                else:
                    differences.extend(compare_outputs(norm1[key], norm2[key], key_path))
        
        elif isinstance(norm1, list) and isinstance(norm2, list):
            # Compare lists
            max_len = max(len(norm1), len(norm2))
            for i in range(max_len):
                item_path = f"{path}[{i}]" if path else f"[{i}]"
                if i >= len(norm1):
                    differences.append({
                        "path": item_path,
                        "type": "missing_item",
                        "runtime1_value": None,
                        "runtime2_value": norm2[i]
                    })
                elif i >= len(norm2):
                    differences.append({
                        "path": item_path,
                        "type": "extra_item",
                        "runtime1_value": norm1[i],
                        "runtime2_value": None
                    })
                else:
                    differences.extend(compare_outputs(norm1[i], norm2[i], item_path))
        
        else:
            # Direct value comparison
            differences.append({
                "path": path or "root",
                "type": "value_difference",
                "runtime1_value": norm1,
                "runtime2_value": norm2
            })
    
    return differences


def compare_runtimes(runtime_results: Dict[str, List[RuntimeResult]]) -> List[ComparisonResult]:
    """Compare results across multiple runtimes."""
    if len(runtime_results) < 2:
        print("Need at least 2 runtimes for comparison")
        return []
    
    # Get all test IDs
    all_test_ids = set()
    for results in runtime_results.values():
        all_test_ids.update(result.test_id for result in results)
    
    # Create lookup dictionaries
    runtime_lookups = {}
    for runtime_name, results in runtime_results.items():
        runtime_lookups[runtime_name] = {result.test_id: result for result in results}
    
    comparison_results = []
    runtimes_list = list(runtime_results.keys())
    
    for test_id in sorted(all_test_ids):
        # Get results for this test from all runtimes
        test_results = {}
        runtimes_tested = []
        
        for runtime_name in runtimes_list:
            if test_id in runtime_lookups[runtime_name]:
                test_results[runtime_name] = runtime_lookups[runtime_name][test_id]
                runtimes_tested.append(runtime_name)
        
        if len(test_results) < 2:
            # Not enough runtimes have this test
            comparison_results.append(ComparisonResult(
                test_id=test_id,
                compatible=False,
                runtimes_tested=runtimes_tested,
                differences=[],
                notes=f"Test only available in {len(test_results)} runtime(s): {', '.join(runtimes_tested)}"
            ))
            continue
        
        # Compare all pairs
        all_compatible = True
        all_differences = []
        
        runtime_pairs = [(runtimes_list[i], runtimes_list[j]) 
                        for i in range(len(runtimes_list)) 
                        for j in range(i + 1, len(runtimes_list))
                        if runtimes_list[i] in test_results and runtimes_list[j] in test_results]
        
        for runtime1, runtime2 in runtime_pairs:
            result1 = test_results[runtime1]
            result2 = test_results[runtime2]
            
            # Compare result status
            if result1.result != result2.result:
                all_compatible = False
                all_differences.append({
                    "type": "result_status",
                    "runtime1": runtime1,
                    "runtime2": runtime2,
                    "runtime1_status": result1.result,
                    "runtime2_status": result2.result
                })
            
            # If both passed, compare outputs
            if result1.result == "pass" and result2.result == "pass":
                output_diffs = compare_outputs(result1.output, result2.output)
                if output_diffs:
                    all_compatible = False
                    for diff in output_diffs:
                        diff.update({
                            "runtime1": runtime1,
                            "runtime2": runtime2
                        })
                    all_differences.extend(output_diffs)
            
            # If both errored, compare error types
            elif result1.result == "error" and result2.result == "error":
                if result1.error_type != result2.error_type:
                    all_compatible = False
                    all_differences.append({
                        "type": "error_type",
                        "runtime1": runtime1,
                        "runtime2": runtime2,
                        "runtime1_error_type": result1.error_type,
                        "runtime2_error_type": result2.error_type
                    })
        
        comparison_results.append(ComparisonResult(
            test_id=test_id,
            compatible=all_compatible,
            runtimes_tested=runtimes_tested,
            differences=all_differences
        ))
    
    return comparison_results


def generate_report(comparison_results: List[ComparisonResult], output_file: Optional[str] = None):
    """Generate a compatibility report."""
    total_tests = len(comparison_results)
    compatible_tests = sum(1 for result in comparison_results if result.compatible)
    compatibility_rate = (compatible_tests / total_tests * 100) if total_tests > 0 else 0
    
    report_lines = [
        "# Prompty Runtime Compatibility Report",
        "",
        f"**Overall Compatibility Rate: {compatibility_rate:.1f}% ({compatible_tests}/{total_tests})**",
        "",
        "## Summary",
        "",
        f"- Total tests: {total_tests}",
        f"- Compatible tests: {compatible_tests}",
        f"- Incompatible tests: {total_tests - compatible_tests}",
        "",
        "## Test Results",
        ""
    ]
    
    for result in comparison_results:
        status_icon = "✅" if result.compatible else "❌"
        report_lines.append(f"### {status_icon} {result.test_id}")
        report_lines.append(f"- **Status**: {'Compatible' if result.compatible else 'Incompatible'}")
        report_lines.append(f"- **Runtimes tested**: {', '.join(result.runtimes_tested)}")
        
        if result.notes:
            report_lines.append(f"- **Notes**: {result.notes}")
        
        if result.differences:
            report_lines.append("- **Differences**:")
            for diff in result.differences:
                if diff["type"] == "result_status":
                    report_lines.append(f"  - Result status differs: {diff['runtime1']}={diff['runtime1_status']} vs {diff['runtime2']}={diff['runtime2_status']}")
                elif diff["type"] == "error_type":
                    report_lines.append(f"  - Error type differs: {diff['runtime1']}={diff['runtime1_error_type']} vs {diff['runtime2']}={diff['runtime2_error_type']}")
                elif diff["type"] == "value_difference":
                    report_lines.append(f"  - Value at `{diff['path']}`: {diff['runtime1']}={diff['runtime1_value']} vs {diff['runtime2']}={diff['runtime2_value']}")
                elif diff["type"] in ["missing_key", "extra_key", "missing_item", "extra_item"]:
                    report_lines.append(f"  - {diff['type']} at `{diff['path']}`: {diff['runtime1']}={diff['runtime1_value']} vs {diff['runtime2']}={diff['runtime2_value']}")
        
        report_lines.append("")
    
    # Add incompatible tests summary
    incompatible_tests = [r for r in comparison_results if not r.compatible]
    if incompatible_tests:
        report_lines.extend([
            "## Incompatible Tests Summary",
            "",
            "The following tests show differences between runtimes:",
            ""
        ])
        
        for result in incompatible_tests:
            report_lines.append(f"- **{result.test_id}**: {len(result.differences)} differences")
    
    report_content = "\n".join(report_lines)
    
    if output_file:
        with open(output_file, 'w') as f:
            f.write(report_content)
        print(f"Report written to {output_file}")
    else:
        print(report_content)


def main():
    parser = argparse.ArgumentParser(description="Compare Prompty TCK results across runtimes")
    parser.add_argument("result_files", nargs="+", help="Runtime result JSON files")
    parser.add_argument("--output", "-o", help="Output report file (default: stdout)")
    parser.add_argument("--format", choices=["markdown", "json"], default="markdown", help="Output format")
    
    args = parser.parse_args()
    
    if len(args.result_files) < 2:
        print("Error: Need at least 2 runtime result files for comparison")
        sys.exit(1)
    
    # Load results from all files
    runtime_results = {}
    for file_path in args.result_files:
        try:
            results = load_runtime_results(file_path)
            if results:
                runtime_name = results[0].runtime
                runtime_results[runtime_name] = results
                print(f"Loaded {len(results)} results for {runtime_name}")
        except Exception as e:
            print(f"Error loading {file_path}: {e}")
            sys.exit(1)
    
    # Compare runtimes
    comparison_results = compare_runtimes(runtime_results)
    
    if args.format == "json":
        # JSON output
        json_output = []
        for result in comparison_results:
            json_output.append({
                "test_id": result.test_id,
                "compatible": result.compatible,
                "runtimes_tested": result.runtimes_tested,
                "differences": result.differences,
                "notes": result.notes
            })
        
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(json_output, f, indent=2)
        else:
            print(json.dumps(json_output, indent=2))
    else:
        # Markdown report
        generate_report(comparison_results, args.output)


if __name__ == "__main__":
    main()
