plugins {
    id("java-library")
    // Publishes the shared spec-vector harness so every provider module grades itself against the
    // same fixtures, rather than each one re-implementing vector loading and comparison.
    id("java-test-fixtures")
}

dependencies {
    // YAML frontmatter parsing. The generated model carries a dependency-free YAML
    // subset reader (TypraYaml); the loader uses SnakeYAML so real-world `.prompty`
    // frontmatter (block scalars, comments, anchors) parses correctly.
    api("org.yaml:snakeyaml:2.4")

    // Template engines: `jinjava` backs the `jinja2` format kind and `mustache.java`
    // backs the `mustache` format kind.
    implementation("com.hubspot.jinjava:jinjava:2.7.4")
    implementation("com.github.spullara.mustache.java:compiler:0.9.14")

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")

    testFixturesApi(platform("org.junit:junit-bom:5.11.4"))
    testFixturesApi("org.junit.jupiter:junit-jupiter")
}
