"""
Prompty Test Compatibility Kit (TCK) Interface

This module defines the common interface that all runtime implementations
must implement to participate in the TCK.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union
from dataclasses import dataclass
from enum import Enum
import json


class TestResult(Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"
    ERROR = "error"


@dataclass
class TCKTestResult:
    test_id: str
    result: TestResult
    runtime: str
    execution_time_ms: float
    output: Optional[Any] = None
    error_message: Optional[str] = None
    error_type: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class TCKComparisonResult:
    test_id: str
    runtimes: List[str]
    compatible: bool
    differences: List[Dict[str, Any]]
    notes: Optional[str] = None


class TCKRuntimeInterface(ABC):
    """
    Interface that each Prompty runtime must implement for TCK testing.
    """
    
    @property
    @abstractmethod
    def runtime_name(self) -> str:
        """Return the name of this runtime (e.g., 'python', 'csharp', 'java')."""
        pass
    
    @property
    @abstractmethod
    def runtime_version(self) -> str:
        """Return the version of this runtime implementation."""
        pass
    
    @abstractmethod
    def parse_prompty(self, prompty_content: str, global_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Parse a .prompty file content and return the structured representation.
        
        Args:
            prompty_content: Raw content of the .prompty file
            global_config: Optional global configuration
            
        Returns:
            Dictionary containing the parsed prompty structure
            
        Raises:
            Any parsing errors should be raised as exceptions
        """
        pass
    
    @abstractmethod
    def render_template(self, prompty_content: str, inputs: Dict[str, Any], 
                       global_config: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Render a prompty template with the given inputs.
        
        Args:
            prompty_content: Raw content of the .prompty file
            inputs: Input variables for template rendering
            global_config: Optional global configuration
            
        Returns:
            List of rendered messages (role/content pairs)
            
        Raises:
            Any rendering errors should be raised as exceptions
        """
        pass
    
    @abstractmethod
    def validate_inputs(self, prompty_content: str, inputs: Dict[str, Any]) -> List[str]:
        """
        Validate inputs against the prompty specification.
        
        Args:
            prompty_content: Raw content of the .prompty file
            inputs: Input variables to validate
            
        Returns:
            List of validation error messages (empty if valid)
        """
        pass
    
    @abstractmethod
    def get_sample_data(self, prompty_content: str) -> Dict[str, Any]:
        """
        Extract sample data from the prompty file.
        
        Args:
            prompty_content: Raw content of the .prompty file
            
        Returns:
            Dictionary containing sample data
        """
        pass
    
    def normalize_output(self, output: Any) -> Any:
        """
        Normalize output for cross-runtime comparison.
        Override this method if runtime-specific normalization is needed.
        
        Args:
            output: Output to normalize
            
        Returns:
            Normalized output
        """
        return output


class TCKTestRunner:
    """
    Test runner that executes TCK tests against runtime implementations.
    """
    
    def __init__(self, runtimes: List[TCKRuntimeInterface]):
        self.runtimes = {runtime.runtime_name: runtime for runtime in runtimes}
    
    def run_test(self, test_spec: Dict[str, Any], runtime_name: str) -> TCKTestResult:
        """
        Run a single test against a specific runtime.
        
        Args:
            test_spec: Test specification from tck-tests.json
            runtime_name: Name of the runtime to test
            
        Returns:
            Test result
        """
        # Implementation would go here
        pass
    
    def run_all_tests(self, test_specs: List[Dict[str, Any]], 
                     runtime_names: Optional[List[str]] = None) -> List[TCKTestResult]:
        """
        Run all tests against specified runtimes.
        
        Args:
            test_specs: List of test specifications
            runtime_names: Optional list of runtime names to test (defaults to all)
            
        Returns:
            List of test results
        """
        # Implementation would go here
        pass
    
    def compare_runtimes(self, test_specs: List[Dict[str, Any]], 
                        runtime_names: List[str]) -> List[TCKComparisonResult]:
        """
        Compare outputs between different runtimes for compatibility verification.
        
        Args:
            test_specs: List of test specifications
            runtime_names: List of runtime names to compare
            
        Returns:
            List of comparison results
        """
        # Implementation would go here
        pass


def normalize_for_comparison(data: Any) -> Any:
    """
    Normalize data structures for cross-runtime comparison.
    
    This function handles differences in how different languages/runtimes
    represent similar data structures (e.g., ordering, null vs None, etc.)
    """
    if isinstance(data, dict):
        # Sort keys for consistent ordering
        return {k: normalize_for_comparison(v) for k, v in sorted(data.items())}
    elif isinstance(data, list):
        return [normalize_for_comparison(item) for item in data]
    elif data is None:
        return None
    elif isinstance(data, (int, float, str, bool)):
        return data
    else:
        # Convert other types to string representation
        return str(data)


def load_test_specifications(file_path: str) -> List[Dict[str, Any]]:
    """
    Load test specifications from a JSON file.
    
    Args:
        file_path: Path to the tck-tests.json file
        
    Returns:
        List of test specifications
    """
    with open(file_path, 'r') as f:
        spec = json.load(f)
    return spec['tests']
