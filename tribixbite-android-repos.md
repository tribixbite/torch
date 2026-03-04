# tribixbite Android Repos — Architecture Overview

> Repos where tribixbite is the most recent committer, filtered to Android-related projects.

## Native Android Apps

| Project | Language | UI Framework | Min/Target SDK | Architecture | Key Libraries |
|---------|----------|-------------|----------------|--------------|---------------|
| **CleverKeys** | Kotlin | Jetpack Compose + Material 3 | 21 / 34 | IME Service | ONNX Runtime (neural swipe), Coil, Coroutines, MultiDex |
| **CustomCamera** | Kotlin | ViewBinding + Material | 24 / 35 | MVVM | CameraX 1.5, ML Kit (Barcode/Object/Label), LeakCanary |
| **stoatally** | Kotlin | Jetpack Compose + Material 3 | 26 / 36 | MVVM + Hilt DI, multi-module | Ktor 3.3, SQLDelight, Media3/ExoPlayer, LiveKit, Firebase Messaging, Sentry, Glide, ZXing |
| **Embeddy** | Kotlin | Jetpack Compose + Material 3 | 26 / 35 | ViewModel + Compose (manual DI) | FFmpeg Kit 6.1, AVIF Coder, Media3, Coil, Jsoup, WorkManager, Timber |
| **Unexpected-Keyboard** | Kotlin + Java | ViewBinding + Custom Views | 21 / 35 | IME Service | ONNX Runtime (neural swipe), AndroidX Window, Detekt |
| **GlassAssistant** | Kotlin | ViewBinding + Navigation Component | 19 / 19 (Glass XE24) | Single Activity + Nav | CameraX, DataStore, EventBus, ZXing, OkHttp, MultiDex |
| **Glass-Thermal-Imaging** | Java + C/NDK | GDK (Glass Dev Kit) | 19 / 19 (Glass XE24) | Multi-module library | UVC Camera, FLIR Boson USB, libjpeg-turbo, libusb, JNI |

## Hybrid / Cross-Platform Android

| Project | Language | Framework | Min/Target SDK | Key Libraries |
|---------|----------|-----------|----------------|---------------|
| **FlixCapacitor** | TypeScript + Kotlin | Capacitor 7 | 23 / 35 | Backbone/Marionette, TailwindCSS, Supabase, Glide, OkHttp, WorkManager, custom torrent plugin |
| **popcorntime** | TypeScript + Rust | Tauri 2 (Android capable) | — | React, Zustand, GraphQL (Cynic), Fuse.js, i18next |

## Termux / Android Tooling

| Project | Language | Type | Key Tech |
|---------|----------|------|----------|
| **bun-on-termux** | Shell | Termux runtime scripts | Bun JS runtime via glibc-runner |
| **termux-tools** | TS / JS / Shell | Termux utilities + browser extensions | Chrome extension bridge, Tasker hooks, CLI tools |
| **caption-reverse-live-ocr-tts** | JS / TS | PWA (installable on Android) | Tesseract.js OCR, Web Speech TTS, Electron |

## Excluded (tribixbite is NOT the most recent committer)

| Project | Most Recent Committer |
|---------|-----------------------|
| AnotherGlass | Ink |
| NextChat | Leizhenpeng |
| AmazeFileUtilities | VishalNehra |
| outline-client | jyyi1 |
| neuroswipe_inference_web | proshian |
| caption-reverse-live-ocr-tts-android | (empty repo) |

---

*Generated 2026-03-04*
