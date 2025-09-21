ruff check --fix ./prompty/**/*.py -v
black ./prompty/**/*.py
ruff check --fix ./tests/**/*.py -v
black ./tests/**/*.py