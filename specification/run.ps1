Remove-Item -Path "./prompty-doc/dist" -Recurse -Force
Remove-Item -Path "./prompty/tsp-output" -Recurse -Force
Set-Location -Path "./prompty-doc"
npm run build
Set-Location -Path "../prompty"
npm run generate
Set-Location -Path "../"