# 브리지 수집 캐시 측정

## 2026-09-20 — 발행본 전체 15케이스

isthmus npm 0.8.0 · cartograph 0.20.0 · kartograph 0.12.0 · dartograph 0.15.0 설치본을 사용했다.
[아카이브·Portal 설치 근거](results/published-tools.json)와
[원시 측정·스텝 시간](results/full-corpus-cache-measurements.json)을 보존한다.

15개 케이스 모두 별도의 빈 isthmus 캐시에서 첫 capture는 miss, 같은 입력의 두 번째는 hit였고
전체 보고서가 같았다. 표는 첫 capture와 재사용을 각각 잰 값이며 둘을 합산하지 않는다.
SDK·Swift build·JVM·producer 캐시는 유지했다. 케이스당 한 쌍이므로 일반적인 속도 향상이나
앱 전체 빌드·런타임 성능으로 확대 해석하지 않는다.

| 케이스 | 첫 capture(ms) | 재사용(ms) |
|---|---:|---:|
| bp-file-swift-plugin | 11446 | 183 |
| bp-file-dart-channel | 2190 | 191 |
| bp-symbol-dart-batterylevel | 2243 | 201 |
| bp-file-event-handler | 2707 | 196 |
| bp-diff-622-623 | 11012 | 477 |
| sp-file-plugin | 12551 | 182 |
| sp-file-generated | 3482 | 185 |
| sp-symbol-legacy-remove | 2155 | 184 |
| sp-diff-253-254 | 11115 | 215 |
| ul-file-plugin | 9556 | 173 |
| ul-symbol-setup | 2183 | 174 |
| ul-diff-321-322 | 9505 | 206 |
| ls-swift-appdelegate | 23546 | 299 |
| ls-dart-macos-channel | 5312 | 302 |
| ls-dart-android-channel | 5425 | 291 |

재현:

```bash
node experiments/real-corpus/run.mjs /path/to/cartograph /path/to/dartograph /path/to/kartograph \
  --isthmus-package /path/to/node_modules/isthmus-cli --measure-cache
```

## 이전 4케이스 측정 — 당시 조건 보존

2026-09-19 개발 중 측정. 같은 입력에서 새 isthmus 캐시로 수집하고 즉시 재사용했다.
네 케이스 모두 첫 수집은 miss, 두 번째는 hit였으며 전체 보고서가 동일했다.

| 케이스 | 새 수집 캐시(ms) | 재사용(ms) | 경계 | 근거 공백 |
|---|---:|---:|---:|---:|
| bridge-app | 2089 | 170 | 2 | 9 |
| sp-file-plugin | 1408 | 135 | 11 | 31 |
| sp-file-generated | 1320 | 138 | 11 | 31 |
| sp-symbol-legacy-remove | 1106 | 132 | 1 | 10 |

`bridge-app`은 합성 표본이다. 나머지 3개는 기존 공개 코퍼스의 shared_preferences_foundation
2.5.4 선택을 로컬 pub 캐시에서 스테이징했다. 캐시의 아카이브 해시 메타데이터는 manifest와
일치했으며 LICENSE와 스테이징한 트리 해시를 확인했다. 원격 아카이브를 다시 받아 캐시
내용을 재인증한 실행은 아니다. 전체 15케이스의 정밀도 재측정도 아니다.

cartograph는 설치본 0.18.0, dartograph는 로컬 0.14.0 AOT 빌드다. 합성 케이스에만 사용한
kartograph는 로컬 제품 소스를 Kotlin 2.4.0/JDK 21로 컴파일한 0.10.2 개발 빌드다.
SDK·Swift 빌드·JVM·생산자 캐시는 지우지 않았다. 각 케이스의 측정은 한 쌍뿐이며
앱 전체 빌드 시간이나 일반적인 속도 향상 추정으로 사용하지 않는다. Flutter 런타임 실행도 없다.

[원시 측정·버전·해시·스텝 시간](results/cache-measurements.json)에 관찰한 공백도 보존했다.

승인된 capture 설정에서 다음 명령으로 재현한다. 설정의 prepare/producer 명령이 실행된다.

```bash
node scripts/measure-preflight-cache.mjs capture.json measurement.json
```
