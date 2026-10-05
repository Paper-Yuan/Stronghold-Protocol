// node_start.cpp — minimal JNI bridge that boots the embedded Node.js runtime
// (nodejs-mobile libnode.so) inside the app process.
//
// node::Start(int argc, char* argv[]) blocks until the Node program exits, so it
// must run on its own Java thread (see NodeRuntime.kt). stdout/stderr are dup2'd
// into a log file in app-private storage so the server's boot banner and errors
// are inspectable even without adb logcat.

#include <jni.h>
#include <unistd.h>

#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <node.h>

extern "C" JNIEXPORT void JNICALL
Java_io_github_sganggs_stronghold_NodeRuntime_setNativeEnv(JNIEnv* env, jclass /*clazz*/,
                                                           jstring jKey, jstring jValue) {
    if (jKey == nullptr || jValue == nullptr) return;
    const char* key = env->GetStringUTFChars(jKey, nullptr);
    const char* val = env->GetStringUTFChars(jValue, nullptr);
    if (key && val) setenv(key, val, 1);
    if (key) env->ReleaseStringUTFChars(jKey, key);
    if (val) env->ReleaseStringUTFChars(jValue, val);
}

extern "C" JNIEXPORT void JNICALL
Java_io_github_sganggs_stronghold_NodeRuntime_startNodeWithArguments(JNIEnv* env, jclass /*clazz*/,
                                                                     jobjectArray jArgs,
                                                                     jstring jLogPath) {
    if (jLogPath != nullptr) {
        const char* logPath = env->GetStringUTFChars(jLogPath, nullptr);
        if (logPath && *logPath) {
            FILE* out = freopen(logPath, "a", stdout);
            FILE* err = freopen(logPath, "a", stderr);
            if (out) setvbuf(out, nullptr, _IOLBF, 0);
            if (err) setvbuf(err, nullptr, _IONBF, 0);
        }
        if (logPath) env->ReleaseStringUTFChars(jLogPath, logPath);
    }

    const jsize argc = env->GetArrayLength(jArgs);
    std::vector<char*> argv;
    argv.reserve(static_cast<size_t>(argc));
    for (jsize i = 0; i < argc; i++) {
        auto js = static_cast<jstring>(env->GetObjectArrayElement(jArgs, i));
        const char* s = env->GetStringUTFChars(js, nullptr);
        argv.push_back(strdup(s ? s : ""));
        env->ReleaseStringUTFChars(js, s);
        env->DeleteLocalRef(js);
    }

    // Blocks until the Node program exits (process shutdown or fatal error).
    node::Start(argc, argv.data());
}
