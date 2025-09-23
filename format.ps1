# set output to verbose
$VerbosePreference = "Continue"
# format csharp code
#print out every action
Write-Host "Formatting C# code..."
#set error action preference to stop on errors
Write-Host "Set-Location ./runtime/csharp"
Set-Location ./runtime/csharp

Write-Host "Running dotnet format..."
dotnet format
Set-Location ../..

# format python code
Write-Host "Formatting Python code..."
Set-Location ./runtime/python/prompty
# activate venv
Write-Host "Activating virtual environment..."
./.venv/Scripts/activate
# run ruff and black
Write-Host "Running ruff and black..."
ruff check --fix ./prompty/**/*.py -v
black ./prompty/**/*.py
ruff check --fix ./tests/**/*.py -v
black ./tests/**/*.py
Set-Location ../../..