plugins {
    id("java-library")
}

dependencies {
    api(project(":prompty"))
    // The Foundry wire format is OpenAI's, so the provider builds on that module rather than
    // restating it.
    api(project(":prompty-openai"))

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation(testFixtures(project(":prompty")))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
