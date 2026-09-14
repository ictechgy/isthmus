# isthmus_runtime

`isthmus_runtime` records the Flutter side of explicitly configured platform
bridge calls as `bridge-runtime` v1 JSON for isthmus. It wraps an injected
`BinaryMessenger`, so an application can use the wrapper in tests or in a
diagnostic build without changing the global Flutter binding.

## Setup

```yaml
dependencies:
  isthmus_runtime:
    path: ../isthmus/packages/isthmus_runtime
```

Configure each route with the codec used by the application. Method channels
are decoded with the supplied `MethodCodec`; Pigeon channels use
`RuntimeBasicMessageChannel` and must provide the generated reply codec and a
reply classifier. The classifier is required because a null BasicMessageChannel
reply can mean either a valid nullable result or a missing native handler.
Names are exact: unconfigured or dynamically constructed
channels are forwarded and are not guessed or recorded. When a test knows a
runtime suffix, `methodChannelResolver` or `basicMessageChannelResolver` can
return a config for that exact name; the recorder never derives a method name
or codec from the string. Exact configurations take precedence over dynamic
resolver callbacks.

```dart
final recorder = IsthmusRuntimeRecorder(
  messenger: ServicesBinding.instance.defaultBinaryMessenger,
  project: '/workspace/app',
  revision: 'git-sha',
  scenario: 'take-photo',
  platform: 'ios',
  methodChannels: const [
    RuntimeMethodChannel(
      channel: 'example/camera',
      codec: StandardMethodCodec(),
      caller: RuntimeCaller(path: 'lib/camera.dart', line: 24, column: 9),
    ),
  ],
);

// Inject recorder.binaryMessenger into MethodChannel/BasicMessageChannel.
final runtime = recorder.finish();
File('runtime.json').writeAsStringSync(runtime.encode());
```

The recorder stores channel, method (for MethodChannel), engine instance,
sequence, caller locations supplied by the caller, and a fixed outcome. It
never stores arguments, results, error text, stack traces, or raw bytes. The
delegate's response bytes, synchronous exceptions, null futures, handlers,
and deprecated platform-message callback are forwarded unchanged. Non-null
futures pass through a forwarding branch so recorder observation does not
swallow an error when the application ignores it. A response observation
timeout only changes the recorded outcome; it never cancels the application's
future.

Timeout describes the observation deadline. The event keeps `timeout` even if a
late reply or exception arrives; that reply or exception still reaches the app.
The run can be `completed` after every underlying reply has settled. Finishing
while a timed-out call still awaits a reply keeps the run `incomplete`, and a
finished snapshot never changes retroactively. Explicit `allowedOutcomes:
["timeout"]` can therefore verify a completed timeout scenario without allowing
unfinished communication to pass.

The package covers MethodChannel and BasicMessageChannel traffic observed from
Flutter to the host. It does not infer channels from source, observe native to
Dart traffic, discover callers from stacks, or prove that an unconfigured
dynamic channel was not used. Unsupported codec data marks the run
`incomplete` conservatively while the application call continues normally.
The test suite uses a fake `BinaryMessenger`; it is not a substitute for a
native iOS/Android integration run.

MIT licensed.
