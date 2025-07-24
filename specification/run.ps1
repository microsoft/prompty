cd prompty-doc
Remove-Item -Path "./dist" -Recurse -Force
npm run build
cd ..
cd prompty
npm run generate
cd ..