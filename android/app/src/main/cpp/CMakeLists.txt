cmake_minimum_required(VERSION 3.22)
project(node_start LANGUAGES CXX)

# Prebuilt Node.js for Mobile Apps runtime, fetched by scripts/pack-android.mjs.
# Headers are committed at src/main/cpp/include/node/, the shared library at
# src/main/jniLibs/<abi>/libnode.so.
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION
        ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so)

add_library(node_start SHARED node_start.cpp)

target_include_directories(node_start PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include/node)

target_link_libraries(node_start node)
