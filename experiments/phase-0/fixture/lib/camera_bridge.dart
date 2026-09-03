import 'package:flutter/services.dart';

final cameraChannel = MethodChannel('dev.isthmus/camera');

Future<void> takePhoto() async {
  await cameraChannel.invokeMethod('takePhoto');
}

MethodChannel dynamicChannel(String feature) =>
    MethodChannel('dev.isthmus/$feature');

Future<void> invokeDynamic(String method) async {
  await cameraChannel.invokeMethod(method);
}

Future<void> takePhotoTypo() async {
  await cameraChannel.invokeMethod('takePhotos');
}
