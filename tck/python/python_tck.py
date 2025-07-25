"""
Python implementation of the Prompty TCK.
"""

import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

# Add the prompty runtime to path
sys.path.append(os.path.join(os.path.dirname(__file__), '../../runtime/prompty'))

import prompty
from prompty.utils import parse


class PythonPromptyTCK:
    """Python implementation of Prompty TCK."""
    
    @property
    def runtime_name(self) -> str:
        return "python"
    
    @property
    def runtime_version(self) -> str:
        # Get version from prompty package if available
        try:
            import prompty
            return getattr(prompty, '__version__', '1.0.0')
        except:
            return "1.0.0"
    
    def parse_prompty(self, prompty_content: str, global_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Parse prompty content using Python implementation."""
        try:
            # Use the prompty.parse function
            parsed = parse(prompty_content)
            
            # Normalize the structure to match expected format
            result = {
                "frontmatter": parsed.get("attributes", {}),
                "content": parsed.get("body", ""),
                "raw_frontmatter": parsed.get("frontmatter", "")
            }
            
            # Extract standard fields
            attrs = parsed.get("attributes", {})
            if attrs:
                result.update({
                    "metadata": {
                        "name": attrs.get("name"),
                        "description": attrs.get("description"),
                        "version": attrs.get("version"),
                        "authors": attrs.get("authors", []),
                        "tags": attrs.get("tags", [])
                    },
                    "model": attrs.get("model", {}),
                    "inputs": attrs.get("inputs", {}),
                    "outputs": attrs.get("outputs", {}),
                    "sample": attrs.get("sample", {}),
                    "template": attrs.get("template", {"format": "jinja2", "parser": "prompty"})
                })
            
            return result
            
        except Exception as e:
            raise Exception(f"Python parsing error: {str(e)}")
    
    def render_template(self, prompty_content: str, inputs: Dict[str, Any], 
                       global_config: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Render template using Python implementation."""
        try:
            # Load the prompty
            p = prompty.load_from_content(prompty_content)
            
            # Prepare/render the template
            rendered = prompty.prepare(p, inputs)
            
            # Convert to standard message format
            if isinstance(rendered, list):
                messages = []
                for item in rendered:
                    if hasattr(item, 'role') and hasattr(item, 'content'):
                        messages.append({
                            "role": item.role,
                            "content": item.content
                        })
                    elif isinstance(item, dict):
                        messages.append({
                            "role": item.get("role", "user"),
                            "content": item.get("content", str(item))
                        })
                    else:
                        messages.append({
                            "role": "user",
                            "content": str(item)
                        })
                return messages
            else:
                # Single string response
                return [{"role": "user", "content": str(rendered)}]
                
        except Exception as e:
            raise Exception(f"Python rendering error: {str(e)}")
    
    def validate_inputs(self, prompty_content: str, inputs: Dict[str, Any]) -> List[str]:
        """Validate inputs against prompty specification."""
        try:
            parsed = self.parse_prompty(prompty_content)
            input_spec = parsed.get("inputs", {})
            errors = []
            
            # Check required inputs
            for input_name, input_def in input_spec.items():
                if isinstance(input_def, dict) and input_def.get("required", False):
                    if input_name not in inputs:
                        errors.append(f"Required input '{input_name}' is missing")
            
            # Check input types (basic validation)
            for input_name, value in inputs.items():
                if input_name in input_spec:
                    input_def = input_spec[input_name]
                    if isinstance(input_def, dict):
                        expected_type = input_def.get("type")
                        if expected_type == "string" and not isinstance(value, str):
                            errors.append(f"Input '{input_name}' should be string, got {type(value).__name__}")
                        elif expected_type == "number" and not isinstance(value, (int, float)):
                            errors.append(f"Input '{input_name}' should be number, got {type(value).__name__}")
                        elif expected_type == "boolean" and not isinstance(value, bool):
                            errors.append(f"Input '{input_name}' should be boolean, got {type(value).__name__}")
                        elif expected_type == "array" and not isinstance(value, list):
                            errors.append(f"Input '{input_name}' should be array, got {type(value).__name__}")
                        elif expected_type == "object" and not isinstance(value, dict):
                            errors.append(f"Input '{input_name}' should be object, got {type(value).__name__}")
            
            return errors
            
        except Exception as e:
            return [f"Validation error: {str(e)}"]
    
    def get_sample_data(self, prompty_content: str) -> Dict[str, Any]:
        """Extract sample data from prompty."""
        try:
            parsed = self.parse_prompty(prompty_content)
            return parsed.get("sample", {})
        except Exception as e:
            raise Exception(f"Python sample extraction error: {str(e)}")


def run_python_tck(test_file: str, output_file: str):
    """
    Run TCK tests for Python implementation.
    
    Args:
        test_file: Path to tck-tests.json
        output_file: Path to write results
    """
    import json
    
    # Load test specifications
    with open(test_file, 'r') as f:
        spec = json.load(f)
    test_specs = spec['tests']
    
    tck = PythonPromptyTCK()
    results = []
    
    for test_spec in test_specs:
        test_id = test_spec["id"]
        
        try:
            # Skip if this runtime is excluded
            if "skip_runtimes" in test_spec and "python" in test_spec["skip_runtimes"]:
                results.append({
                    "test_id": test_id,
                    "result": "skip",
                    "runtime": "python",
                    "execution_time_ms": 0.0
                })
                continue
            
            start_time = time.time()
            
            # Read the prompty file
            prompty_file = test_spec["prompty_file"]
            with open(prompty_file, 'r') as f:
                prompty_content = f.read()
            
            # Set environment variables if specified
            env_vars = test_spec.get("environment_vars", {})
            old_env = {}
            for key, value in env_vars.items():
                old_env[key] = os.environ.get(key)
                os.environ[key] = str(value)
            
            try:
                # Run the test based on category
                category = test_spec["category"]
                
                if category == "specification":
                    # Test parsing
                    result = tck.parse_prompty(prompty_content)
                    
                elif category == "functional":
                    # Test rendering
                    input_data = test_spec.get("input_data", tck.get_sample_data(prompty_content))
                    result = tck.render_template(prompty_content, input_data)
                    
                elif category == "error-handling":
                    # Test error conditions
                    input_data = test_spec.get("input_data", {})
                    expected_errors = test_spec.get("expected_errors", [])
                    
                    try:
                        if "input_data" in test_spec:
                            # Test rendering with invalid input
                            result = tck.render_template(prompty_content, input_data)
                            # If we get here, the test should have failed
                            raise Exception("Expected error did not occur")
                        else:
                            # Test parsing invalid prompty
                            result = tck.parse_prompty(prompty_content)
                            raise Exception("Expected parsing error did not occur")
                    except Exception as e:
                        # Check if this is an expected error
                        error_matched = False
                        for expected_error in expected_errors:
                            import re
                            if re.search(expected_error["message_pattern"], str(e), re.IGNORECASE):
                                error_matched = True
                                break
                        
                        if error_matched:
                            result = {"expected_error": str(e)}
                        else:
                            raise e
                
                else:
                    result = {"message": f"Test category '{category}' not yet implemented"}
                
                execution_time = (time.time() - start_time) * 1000
                
                results.append({
                    "test_id": test_id,
                    "result": "pass",
                    "runtime": "python",
                    "execution_time_ms": execution_time,
                    "output": result
                })
                
            finally:
                # Restore environment variables
                for key, old_value in old_env.items():
                    if old_value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = old_value
                        
        except Exception as e:
            execution_time = (time.time() - start_time) * 1000
            results.append({
                "test_id": test_id,
                "result": "error",
                "runtime": "python",
                "execution_time_ms": execution_time,
                "error_message": str(e),
                "error_type": type(e).__name__
            })
    
    # Write results to file
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("Usage: python python_tck.py <test-file> <output-file>")
        sys.exit(1)
    
    run_python_tck(sys.argv[1], sys.argv[2])
