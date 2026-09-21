// 원본 Sound iOS 구현과 Codegen 앱 모듈을 실제 Hermes/Fabric에서 호출한다.
// 새 iOS SDK의 UIScene 진입점에서도 pinned RN factory를 그대로 사용한다.
export const appDelegate = String.raw`import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool { true }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let delegate = ReactNativeDelegate()
    delegate.dependencyProvider = RCTAppDependencyProvider()
    let factory = RCTReactNativeFactory(delegate: delegate)
    reactNativeDelegate = delegate
    reactNativeFactory = factory
    let appWindow = UIWindow(windowScene: windowScene)
    window = appWindow
    factory.startReactNative(withModuleName: "HelloWorld", in: appWindow, launchOptions: nil)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? { bundleURL() }
  override func bundleURL() -> URL? { Bundle.main.url(forResource: "main", withExtension: "jsbundle") }
}
`;

export const spec = String.raw`import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
export interface Spec extends TurboModule {
  echo(value: string): Promise<string>;
  fail(): Promise<string>;
  finish(value: string): void;
}
export default TurboModuleRegistry.getEnforcing<Spec>('IsthmusIOSProbe');
`;

export const header = String.raw`#import <Foundation/Foundation.h>
#import <IsthmusIOSProbeSpec/IsthmusIOSProbeSpec.h>
@interface IsthmusIOSProbe : NSObject <NativeIsthmusIOSProbeSpec>
@end
`;

export const implementation = String.raw`#import "IsthmusIOSProbe.h"
#import <React/RCTBridgeModule.h>
@implementation IsthmusIOSProbe {
  NSString *_runId;
  NSInteger _calls;
}
RCT_EXPORT_MODULE(IsthmusIOSProbe)
- (instancetype)init { if (self = [super init]) { _runId = [NSUUID UUID].UUIDString; } return self; }
- (void)echo:(NSString *)value resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  _calls++; resolve(value);
}
- (void)fail:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  reject(@"EXPECTED_PROBE_ERROR", @"fixture error", nil);
}
- (void)finish:(NSString *)value {
  NSError *error = nil;
  NSMutableDictionary *result = [[NSJSONSerialization JSONObjectWithData:[value dataUsingEncoding:NSUTF8StringEncoding]
    options:NSJSONReadingMutableContainers error:&error] mutableCopy];
  if (error || ![result isKindOfClass:[NSMutableDictionary class]]) result = [@{@"status": @"invalid-result"} mutableCopy];
  result[@"runId"] = _runId;
  result[@"nativeEchoCalls"] = @(_calls);
#if DEBUG
  result[@"nativeRelease"] = @NO;
#else
  result[@"nativeRelease"] = @YES;
#endif
  NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:&error];
  NSString *directory = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
  BOOL saved = [data writeToFile:[directory stringByAppendingPathComponent:@"rn-probe.json"] options:NSDataWritingAtomic error:&error];
  if (!saved || error) @throw [NSException exceptionWithName:@"FixtureEvidence" reason:@"Fixture evidence write failed" userInfo:nil];
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeIsthmusIOSProbeSpecJSI>(params);
}
@end
`;

export const javascript = String.raw`import React from 'react';
import {AppRegistry, Platform, View} from 'react-native';
import Sound from 'react-native-sound';
import NativeProbe from './specs/NativeIsthmusIOSProbe';
const checks = [], measurements = {};
const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 15000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error(label); await pause(30); }
}
let layout, sound;
const laidOut = new Promise(resolve => { layout = resolve; });
async function probe() {
  check('hermes-engine', !!global.HermesInternal);
  check('ios-platform', Platform.OS === 'ios');
  check('release-js', !__DEV__);
  check('bridgeless-runtime', global.RN$Bridgeless === true);
  check('fabric-manager', !!global.nativeFabricUIManager);
  await Promise.race([laidOut, pause(15000).then(() => { throw new Error('layout-timeout'); })]);
  check('fabric-native-layout', true);
  check('turbo-promise-roundtrip', await NativeProbe.echo('ios-probe') === 'ios-probe');
  let rejected = false;
  try { await NativeProbe.fail(); } catch (error) { rejected = error.code === 'EXPECTED_PROBE_ERROR'; }
  check('turbo-error-roundtrip', rejected);
  Sound.setCategory('Playback', true);
  sound = await new Promise((resolve, reject) => {
    const player = new Sound('isthmus_silence.wav', Sound.MAIN_BUNDLE, error => error ? reject(new Error('prepare')) : resolve(player));
  });
  check('media-prepared', sound.isLoaded());
  check('media-duration', sound.getDuration() >= 1.9 && sound.getDuration() <= 2.1);
  check('initial-state', !sound.isPlaying());
  const started = Date.now();
  const completed = new Promise(resolve => sound.play(resolve));
  await until(() => sound.isPlaying(), 'play-event');
  check('public-play-event', true);
  await pause(250);
  measurements.position = await new Promise(resolve => sound.getCurrentTime(resolve));
  check('media-progress', measurements.position > 0 && measurements.position < 2.1);
  check('media-completion', await completed === true);
  measurements.playbackMilliseconds = Date.now() - started;
  check('media-completion-time', measurements.playbackMilliseconds >= 1800 && measurements.playbackMilliseconds < 15000);
  await until(() => !sound.isPlaying(), 'completion-event');
  check('public-completion-event', true);
  sound.setNumberOfLoops(-1); sound.play();
  await until(() => sound.isPlaying(), 'loop-play');
  await new Promise(resolve => sound.pause(resolve));
  check('media-pause', !sound.isPlaying());
  sound.play(); await until(() => sound.isPlaying(), 'resume-play');
  check('media-resume', true);
  await new Promise(resolve => sound.stop(resolve));
  check('media-stop', !sound.isPlaying());
  sound.release();
  check('media-released', !sound.isLoaded());
  NativeProbe.finish(JSON.stringify({status: 'passed', checks, measurements, reactNative: Platform.constants.reactNativeVersion}));
}
AppRegistry.registerComponent('HelloWorld', () => () => React.createElement(View, {
  style: {width: 80, height: 80}, onLayout: event => { if (event.nativeEvent.layout.width === 80) layout(); },
}));
probe().catch(error => NativeProbe.finish(JSON.stringify({status: 'failed', checks, measurements,
  failure: typeof error.message === 'string' && /^[a-z-]{1,100}$/.test(error.message) ? error.message : 'native-call-failed'})))
  .finally(() => { if (sound?.isLoaded()) sound.release(); });
`;
