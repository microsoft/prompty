rootProject.name = "prompty-java"

include("prompty")
include("prompty-openai")
include("prompty-anthropic")
include("prompty-foundry")

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}
