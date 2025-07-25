#!/usr/bin/env python3
"""
Prompty TCK Performance Monitor

This script analyzes TCK results to track performance metrics and detect regressions.
"""

import json
import argparse
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Any
import statistics

class PerformanceMonitor:
    def __init__(self, results_dir: str, baseline_file: str = None):
        self.results_dir = Path(results_dir)
        self.baseline_file = baseline_file
        self.metrics = {}
        
    def analyze_results(self) -> Dict[str, Any]:
        """Analyze TCK results for performance metrics."""
        
        performance_data = {
            'timestamp': time.time(),
            'runtimes': {},
            'summary': {}
        }
        
        # Process each runtime's results
        for runtime in ['python', 'csharp', 'java']:
            result_file = self.results_dir / f"{runtime}-results.json"
            if result_file.exists():
                runtime_metrics = self._analyze_runtime_results(result_file, runtime)
                performance_data['runtimes'][runtime] = runtime_metrics
        
        # Calculate cross-runtime summary
        performance_data['summary'] = self._calculate_summary(performance_data['runtimes'])
        
        return performance_data
    
    def _analyze_runtime_results(self, result_file: Path, runtime: str) -> Dict[str, Any]:
        """Analyze results for a specific runtime."""
        
        with open(result_file, 'r') as f:
            results = json.load(f)
        
        metrics = {
            'runtime': runtime,
            'total_tests': 0,
            'passed_tests': 0,
            'failed_tests': 0,
            'error_tests': 0,
            'execution_times': [],
            'memory_usage': [],
            'test_breakdown': {}
        }
        
        if 'results' in results:
            for test_result in results['results']:
                metrics['total_tests'] += 1
                
                status = test_result.get('status', 'unknown')
                if status == 'pass':
                    metrics['passed_tests'] += 1
                elif status == 'fail':
                    metrics['failed_tests'] += 1
                elif status == 'error':
                    metrics['error_tests'] += 1
                
                # Collect execution time if available
                exec_time = test_result.get('execution_time_ms', 0)
                if exec_time > 0:
                    metrics['execution_times'].append(exec_time)
                
                # Collect memory usage if available
                memory = test_result.get('memory_usage_mb', 0)
                if memory > 0:
                    metrics['memory_usage'].append(memory)
                
                # Test type breakdown
                test_type = test_result.get('type', 'unknown')
                if test_type not in metrics['test_breakdown']:
                    metrics['test_breakdown'][test_type] = {'count': 0, 'passed': 0}
                metrics['test_breakdown'][test_type]['count'] += 1
                if status == 'pass':
                    metrics['test_breakdown'][test_type]['passed'] += 1
        
        # Calculate statistics
        if metrics['execution_times']:
            metrics['avg_execution_time'] = statistics.mean(metrics['execution_times'])
            metrics['median_execution_time'] = statistics.median(metrics['execution_times'])
            metrics['max_execution_time'] = max(metrics['execution_times'])
            metrics['min_execution_time'] = min(metrics['execution_times'])
        
        if metrics['memory_usage']:
            metrics['avg_memory_usage'] = statistics.mean(metrics['memory_usage'])
            metrics['peak_memory_usage'] = max(metrics['memory_usage'])
        
        metrics['success_rate'] = (
            metrics['passed_tests'] / metrics['total_tests'] 
            if metrics['total_tests'] > 0 else 0
        )
        
        return metrics
    
    def _calculate_summary(self, runtime_metrics: Dict[str, Dict]) -> Dict[str, Any]:
        """Calculate cross-runtime summary metrics."""
        
        summary = {
            'total_runtimes': len(runtime_metrics),
            'overall_success_rate': 0,
            'fastest_runtime': None,
            'slowest_runtime': None,
            'most_memory_efficient': None,
            'compatibility_matrix': {}
        }
        
        if not runtime_metrics:
            return summary
        
        # Calculate overall success rate
        total_tests = sum(m['total_tests'] for m in runtime_metrics.values())
        total_passed = sum(m['passed_tests'] for m in runtime_metrics.values())
        summary['overall_success_rate'] = total_passed / total_tests if total_tests > 0 else 0
        
        # Find fastest/slowest runtimes
        avg_times = {}
        for runtime, metrics in runtime_metrics.items():
            if 'avg_execution_time' in metrics:
                avg_times[runtime] = metrics['avg_execution_time']
        
        if avg_times:
            summary['fastest_runtime'] = min(avg_times, key=avg_times.get)
            summary['slowest_runtime'] = max(avg_times, key=avg_times.get)
        
        # Find most memory efficient
        avg_memory = {}
        for runtime, metrics in runtime_metrics.items():
            if 'avg_memory_usage' in metrics:
                avg_memory[runtime] = metrics['avg_memory_usage']
        
        if avg_memory:
            summary['most_memory_efficient'] = min(avg_memory, key=avg_memory.get)
        
        # Compatibility matrix
        for runtime, metrics in runtime_metrics.items():
            summary['compatibility_matrix'][runtime] = {
                'success_rate': metrics['success_rate'],
                'total_tests': metrics['total_tests'],
                'test_types': list(metrics['test_breakdown'].keys())
            }
        
        return summary
    
    def compare_with_baseline(self, current_data: Dict[str, Any]) -> Dict[str, Any]:
        """Compare current results with baseline if available."""
        
        if not self.baseline_file or not os.path.exists(self.baseline_file):
            return {'baseline_available': False}
        
        with open(self.baseline_file, 'r') as f:
            baseline_data = json.load(f)
        
        comparison = {
            'baseline_available': True,
            'regressions': [],
            'improvements': [],
            'performance_delta': {}
        }
        
        # Compare runtime performance
        for runtime in current_data['runtimes']:
            if runtime in baseline_data.get('runtimes', {}):
                current_metrics = current_data['runtimes'][runtime]
                baseline_metrics = baseline_data['runtimes'][runtime]
                
                # Compare execution time
                current_time = current_metrics.get('avg_execution_time', 0)
                baseline_time = baseline_metrics.get('avg_execution_time', 0)
                
                if baseline_time > 0:
                    time_delta = ((current_time - baseline_time) / baseline_time) * 100
                    comparison['performance_delta'][runtime] = {
                        'execution_time_change_percent': time_delta
                    }
                    
                    # Flag significant regressions/improvements
                    if time_delta > 20:  # 20% slower
                        comparison['regressions'].append({
                            'runtime': runtime,
                            'type': 'execution_time',
                            'change_percent': time_delta
                        })
                    elif time_delta < -20:  # 20% faster
                        comparison['improvements'].append({
                            'runtime': runtime,
                            'type': 'execution_time',
                            'change_percent': abs(time_delta)
                        })
                
                # Compare success rate
                current_success = current_metrics.get('success_rate', 0)
                baseline_success = baseline_metrics.get('success_rate', 0)
                
                if current_success < baseline_success:
                    comparison['regressions'].append({
                        'runtime': runtime,
                        'type': 'success_rate',
                        'current': current_success,
                        'baseline': baseline_success
                    })
        
        return comparison
    
    def generate_report(self, output_file: str = None) -> str:
        """Generate a comprehensive performance report."""
        
        performance_data = self.analyze_results()
        comparison = self.compare_with_baseline(performance_data)
        
        report = []
        report.append("# Prompty TCK Performance Report")
        report.append(f"Generated at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        report.append("")
        
        # Summary section
        summary = performance_data['summary']
        report.append("## Summary")
        report.append(f"- Total Runtimes Tested: {summary['total_runtimes']}")
        report.append(f"- Overall Success Rate: {summary['overall_success_rate']:.2%}")
        
        if summary.get('fastest_runtime'):
            report.append(f"- Fastest Runtime: {summary['fastest_runtime']}")
        if summary.get('slowest_runtime'):
            report.append(f"- Slowest Runtime: {summary['slowest_runtime']}")
        if summary.get('most_memory_efficient'):
            report.append(f"- Most Memory Efficient: {summary['most_memory_efficient']}")
        
        report.append("")
        
        # Runtime details
        report.append("## Runtime Performance Details")
        for runtime, metrics in performance_data['runtimes'].items():
            report.append(f"### {runtime.title()} Runtime")
            report.append(f"- Tests: {metrics['passed_tests']}/{metrics['total_tests']} passed")
            report.append(f"- Success Rate: {metrics['success_rate']:.2%}")
            
            if 'avg_execution_time' in metrics:
                report.append(f"- Average Execution Time: {metrics['avg_execution_time']:.2f}ms")
                report.append(f"- Median Execution Time: {metrics['median_execution_time']:.2f}ms")
                report.append(f"- Execution Time Range: {metrics['min_execution_time']:.2f}ms - {metrics['max_execution_time']:.2f}ms")
            
            if 'avg_memory_usage' in metrics:
                report.append(f"- Average Memory Usage: {metrics['avg_memory_usage']:.2f}MB")
                report.append(f"- Peak Memory Usage: {metrics['peak_memory_usage']:.2f}MB")
            
            report.append("")
        
        # Baseline comparison
        if comparison['baseline_available']:
            report.append("## Baseline Comparison")
            
            if comparison['regressions']:
                report.append("### ⚠️ Performance Regressions")
                for regression in comparison['regressions']:
                    if regression['type'] == 'execution_time':
                        report.append(f"- {regression['runtime']}: {regression['change_percent']:.1f}% slower")
                    elif regression['type'] == 'success_rate':
                        report.append(f"- {regression['runtime']}: Success rate dropped from {regression['baseline']:.2%} to {regression['current']:.2%}")
                report.append("")
            
            if comparison['improvements']:
                report.append("### ✅ Performance Improvements")
                for improvement in comparison['improvements']:
                    report.append(f"- {improvement['runtime']}: {improvement['change_percent']:.1f}% faster")
                report.append("")
            
            if not comparison['regressions'] and not comparison['improvements']:
                report.append("- No significant performance changes detected")
                report.append("")
        
        # Detailed metrics
        report.append("## Detailed Metrics")
        report.append("```json")
        report.append(json.dumps(performance_data, indent=2))
        report.append("```")
        
        report_text = "\n".join(report)
        
        if output_file:
            with open(output_file, 'w') as f:
                f.write(report_text)
            print(f"Performance report written to: {output_file}")
        
        return report_text

def main():
    parser = argparse.ArgumentParser(description="Prompty TCK Performance Monitor")
    parser.add_argument("--results-dir", default="results", 
                       help="Directory containing TCK results")
    parser.add_argument("--baseline", 
                       help="Baseline performance data file for comparison")
    parser.add_argument("--output", 
                       help="Output file for performance report")
    parser.add_argument("--format", choices=['markdown', 'json'], default='markdown',
                       help="Output format")
    parser.add_argument("--save-baseline", 
                       help="Save current results as new baseline")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.results_dir):
        print(f"Error: Results directory '{args.results_dir}' not found")
        sys.exit(1)
    
    monitor = PerformanceMonitor(args.results_dir, args.baseline)
    
    if args.format == 'json':
        data = monitor.analyze_results()
        output = json.dumps(data, indent=2)
    else:
        output = monitor.generate_report(args.output)
    
    if args.save_baseline:
        data = monitor.analyze_results()
        with open(args.save_baseline, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"Baseline saved to: {args.save_baseline}")
    
    if not args.output:
        print(output)

if __name__ == "__main__":
    main()
