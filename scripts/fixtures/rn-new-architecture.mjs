// 실제 Codegen/TurboModule, Fabric renderer, 공개 Sound의 재생·구독을 검증하는 앱이다.
export const spec = String.raw`import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
export interface Spec extends TurboModule {
  echo(value: string): Promise<string>;
  reject(): Promise<string>;
  emitPlayState(key: number, playing: boolean): Promise<void>;
  checkpoint(value: string): void;
  finish(value: string): void;
}
export default TurboModuleRegistry.getEnforcing<Spec>('IsthmusProbe');
`;

export const kotlin = String.raw`package com.helloworld

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BridgeReactContext.RCTDeviceEventEmitter
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import java.io.File
import org.json.JSONObject

class ProbePackage : BaseReactPackage() {
  override fun getModule(name: String, context: ReactApplicationContext): NativeModule? =
    if (name == "IsthmusProbe") ProbeModule(context) else null
  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf("IsthmusProbe" to ReactModuleInfo("IsthmusProbe", "IsthmusProbe", false, false, false, true))
  }
}

class ProbeModule(private val context: ReactApplicationContext) : NativeIsthmusProbeSpec(context) {
  private var calls = 0
  private var controlEmissions = 0
  override fun getName() = "IsthmusProbe"
  override fun echo(value: String, promise: Promise) { calls += 1; promise.resolve(value) }
  override fun reject(promise: Promise) { promise.reject("EXPECTED_PROBE_ERROR", "fixture error") }
  override fun emitPlayState(key: Double, playing: Boolean, promise: Promise) {
    val value = Arguments.createMap()
    value.putDouble("playerKey", key); value.putBoolean("isPlaying", playing)
    context.getJSModule(RCTDeviceEventEmitter::class.java).emit("onPlayChange", value)
    controlEmissions += 1
    promise.resolve(null)
  }
  override fun checkpoint(value: String) { write("rn-checkpoint.json", JSONObject().put("phase", value)) }
  override fun finish(value: String) {
    val result = JSONObject(value)
    result.put("nativeEchoCalls", calls)
    result.put("controlEmissions", controlEmissions)
    result.put("androidDebuggable", context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0)
    result.put("newArchitectureEnabled", BuildConfig.IS_NEW_ARCHITECTURE_ENABLED)
    write("rn-probe.json", result)
  }
  private fun write(name: String, value: JSONObject) {
    val directory = requireNotNull(context.getExternalFilesDir(null))
    val pending = File(directory, name + ".pending")
    pending.writeText(value.toString())
    check(pending.renameTo(File(directory, name))) { "Fixture evidence rename failed" }
  }
}
`;

export const javascript = String.raw`import React from 'react';
import {AppRegistry, AppState, Platform, View} from 'react-native';
import Sound from 'react-native-sound';
import NativeProbe from './specs/NativeIsthmusProbe';

const checks = [];
const measurements = {};
const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, name, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(name);
    await pause(30);
  }
}
const load = filename => new Promise((resolve, reject) => {
  const sound = new Sound(filename, '', error => error ? reject(new Error('prepare')) : resolve(sound));
});
let layout;
const laidOut = new Promise(resolve => { layout = resolve; });
const states = [];
const subscription = AppState.addEventListener('change', state => states.push(state));
const activeSounds = [];

async function probe() {
  check('hermes-engine', !!global.HermesInternal);
  check('android-platform', Platform.OS === 'android');
  check('release-js', !__DEV__);
  check('bridgeless-runtime', global.RN$Bridgeless === true);
  check('fabric-manager', !!global.nativeFabricUIManager);
  await Promise.race([laidOut, pause(15000).then(() => { throw new Error('layout-timeout'); })]);
  check('fabric-native-layout', true);
  check('turbo-promise-roundtrip', await NativeProbe.echo('probe') === 'probe');
  let rejected = false;
  try { await NativeProbe.reject(); } catch (error) { rejected = error.code === 'EXPECTED_PROBE_ERROR'; }
  check('turbo-error-roundtrip', rejected);

  const first = await load('isthmus_silence.wav'); activeSounds.push(first);
  const second = await load('isthmus_silence.wav'); activeSounds.push(second);
  check('media-prepared', first.isLoaded() && second.isLoaded());
  check('media-duration', first.getDuration() >= 1.9 && first.getDuration() <= 2.1);
  check('initial-state', !first.isPlaying() && !second.isPlaying());
  // 무음 PCM을 실제 MediaPlayer로 재생한다. 사용자의 시스템 볼륨은 바꾸지 않는다.
  const playbackStarted = Date.now();
  const completed = new Promise(resolve => first.play(resolve));
  await until(() => first.isPlaying(), 'play-event');
  check('public-play-event', true);
  check('other-player-excluded', !second.isPlaying());
  await pause(250);
  measurements.playingPosition = await new Promise(resolve => first.getCurrentTime(resolve));
  check('media-completion', await completed === true);
  measurements.playbackMilliseconds = Date.now() - playbackStarted;
  const position = await new Promise(resolve => first.getCurrentTime(resolve));
  measurements.completionPosition = position;
  // 이 Android 경로는 완료 뒤 position을 0으로 돌린다. 재생 중 진행과 실제 경과 시간을 대조한다.
  check('media-progress-and-completion-time', measurements.playingPosition > 0 && measurements.playingPosition < 2.1 &&
    measurements.playbackMilliseconds >= 1800 && measurements.playbackMilliseconds < 15000);
  await until(() => !first.isPlaying(), 'completion-event');
  check('public-completion-event', true);

  second.setNumberOfLoops(-1);
  second.play();
  await until(() => second.isPlaying(), 'loop-start');
  await new Promise(resolve => second.pause(resolve));
  check('media-pause', !second.isPlaying());
  second.play();
  await until(() => second.isPlaying(), 'resume-play');
  check('media-resume', true);
  await new Promise(resolve => second.stop(resolve));
  check('media-stop', !second.isPlaying());

  first.release();
  const releasedState = first.isPlaying();
  // 해제한 바로 그 player key로 재전송해 key 필터와 실제 구독 해제를 구분한다.
  await NativeProbe.emitPlayState(0, true); await pause(120);
  check('removed-subscription-excluded', !first.isPlaying());
  second.play();
  await until(() => second.isPlaying(), 'remaining-subscription');
  check('released-player-excluded', first.isPlaying() === releasedState && !first.isLoaded());
  check('remaining-subscription-receives', true);
  await new Promise(resolve => second.stop(resolve));

  const lifecycleStart = states.length;
  NativeProbe.checkpoint('awaiting-background');
  await until(() => states.indexOf('background', lifecycleStart) >= 0, 'background-transition', 60000);
  await until(() => states.slice(states.indexOf('background', lifecycleStart) + 1).includes('active'), 'foreground-transition', 60000);
  check('background-foreground', true);
  check('turbo-after-resume', await NativeProbe.echo('resumed') === 'resumed');
  second.play();
  await until(() => second.isPlaying(), 'post-resume-event');
  check('public-event-after-resume', true);
  await new Promise(resolve => second.stop(resolve));
  second.release();
  check('media-released', !second.isLoaded());
  NativeProbe.finish(JSON.stringify({status: 'passed', checks, states, measurements,
    reactNative: Platform.constants.reactNativeVersion, engine: 'Hermes'}));
}

AppRegistry.registerComponent('HelloWorld', () => () => React.createElement(View, {
  style: {width: 80, height: 80},
  onLayout: event => { if (event.nativeEvent.layout.width === 80) layout(); },
}));
probe().catch(error => NativeProbe.finish(JSON.stringify({status: 'failed', checks, states, measurements,
  failure: typeof error.message === 'string' && /^[a-z-]{1,100}$/.test(error.message) ? error.message : 'native-call-failed'})))
  .finally(() => { subscription.remove(); for (const sound of activeSounds) if (sound.isLoaded()) sound.release(); });
`;

/** 2초짜리 mono PCM 무음. 외부 미디어나 시스템 볼륨 변경 없이 native 재생을 검사한다. */
export function silentWav() {
  const rate = 8000;
  const bytes = Buffer.alloc(44 + rate * 2 * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
