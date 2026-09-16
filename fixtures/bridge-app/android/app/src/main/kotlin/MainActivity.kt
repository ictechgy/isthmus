package com.example.coldcache

import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class CameraBridge(engine: FlutterEngine) {
    private val channel = MethodChannel(engine.dartExecutor.binaryMessenger, "camera")

    init {
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "photo" -> result.success(null)
                else -> result.notImplemented()
            }
        }
    }
}
