module prompty

go 1.25.1

require gopkg.in/yaml.v3 v3.0.1 // indirect

require vectoradapters v0.0.0

replace vectoradapters => ./vectoradapters

require vectorrunner v0.0.0

replace vectorrunner => ./model/vectorrunner
