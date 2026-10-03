# Stronghold-Protocol Proguard Rules
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.paper.stronghold.AndroidBridge { *; }
