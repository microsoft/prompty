plugins {
    id("java-library")
}

dependencies {
    api(project(":prompty"))

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation(testFixtures(project(":prompty")))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
