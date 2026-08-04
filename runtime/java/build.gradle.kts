plugins {
    id("java-library")
}

allprojects {
    group = "com.microsoft.prompty"
    version = "2.0.0-beta.4"
}

subprojects {
    apply(plugin = "java-library")

    repositories {
        mavenCentral()
    }

    extensions.configure<JavaPluginExtension> {
        toolchain {
            languageVersion.set(JavaLanguageVersion.of(21))
        }
        withSourcesJar()
    }

    tasks.withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
        // Generated model sources are emitted by Typra and are not warning-clean by
        // design; keep the build strict for hand-written code only.
        options.compilerArgs.addAll(listOf("-Xlint:all", "-Xlint:-serial", "-Xlint:-this-escape"))
    }

    tasks.withType<Test>().configureEach {
        // Live provider tests call real endpoints; they are opt-in via -PliveTests.
        val liveTests = providers.gradleProperty("liveTests").isPresent
        useJUnitPlatform {
            if (!liveTests) {
                excludeTags("live")
            }
        }
        testLogging {
            events("failed")
            exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        }
    }

    tasks.withType<Javadoc>().configureEach {
        (options as StandardJavadocDocletOptions).addStringOption("Xdoclint:none", "-quiet")
    }
}
