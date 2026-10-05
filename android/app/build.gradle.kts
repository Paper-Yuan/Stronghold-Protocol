plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.github.sganggs.stronghold"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.sganggs.stronghold"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.3"

        // arm64-v8a: modern phones (incl. the target Android 16 devices)
        // x86_64: desktop emulators. armeabi-v7a can be added in local builds.
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }

        externalNativeBuild {
            cmake {
                // c++_shared: libnode.so itself links against the NDK's shared STL,
                // so the glue library must use the same runtime.
                arguments += listOf("-DANDROID_STL=c++_shared")
                cppFlags += listOf("-std=c++17", "-fno-exceptions", "-fno-rtti")
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    // core.zip / assets.zip are already-compressed archives — store them 1:1 in the APK
    // so first-run extraction is a pure copy (fast, no CPU burn).
    androidResources {
        noCompress += listOf("zip")
    }

    packaging {
        // libnode.so is huge; keep it uncompressed & page-aligned in the APK (loaded in place).
        jniLibs { useLegacyPackaging = false }
    }

    buildFeatures {
        buildConfig = true // the bridge and DebugLog report VERSION_NAME/VERSION_CODE
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
        }
        debug { applicationIdSuffix = "" }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
