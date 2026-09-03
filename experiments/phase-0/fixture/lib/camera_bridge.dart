import 'package:flutter/services.dart';

final cameraChannel = MethodChannel('dev.isthmus/camera');

Future<void> takePhoto() async {
  await cameraChannel.invokeMethod('takePhoto');
}
