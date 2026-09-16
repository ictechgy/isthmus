import 'package:flutter/services.dart';

const MethodChannel _channel = MethodChannel('camera');

Future<void> takePhoto() async {
  await _channel.invokeMethod('photo');
}
